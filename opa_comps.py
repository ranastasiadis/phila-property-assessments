#!/usr/bin/env python3
"""
Philadelphia Property Assessment & Dynamic Comps Analyzer
Connects to the City of Philadelphia OPA Carto API to find closest comparable parcels
and evaluate property assessment changes.
"""

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

CARTO_SQL_URL = "https://phl.carto.com/api/v2/sql"


def execute_carto_query(query: str) -> List[Dict[str, Any]]:
    """Execute a SQL query against Philadelphia Carto API endpoint."""
    url = f"{CARTO_SQL_URL}?q={urllib.parse.quote(query)}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PhilaPropertyComps/1.0 (Tax Assessment Analyzer)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("rows", [])
    except Exception as e:
        print(f"Error executing Carto query: {e}", file=sys.stderr)
        return []


def clean_address(address: str) -> str:
    """Normalize input address string for OPA lookup."""
    import re
    if not address:
        return ""
    addr = address.strip().upper()
    addr = re.sub(r"[.,#]", " ", addr)
    addr = re.sub(r"\s+", " ", addr)
    replacements = [
        (r"\bSTREET\b", "ST"),
        (r"\bAVENUE\b", "AVE"),
        (r"\bROAD\b", "RD"),
        (r"\bBOULEVARD\b", "BLVD"),
        (r"\bDRIVE\b", "DR"),
        (r"\bLANE\b", "LN"),
        (r"\bCOURT\b", "CT"),
        (r"\bPLACE\b", "PL"),
        (r"\bTERRACE\b", "TER"),
        (r"\bWAY\b", "WAY"),
        (r"\bNORTH\b", "N"),
        (r"\bSOUTH\b", "S"),
        (r"\bEAST\b", "E"),
        (r"\bWEST\b", "W"),
    ]
    for pattern, repl in replacements:
        addr = re.sub(pattern, repl, addr)
    return addr.strip()


def get_property_by_address(address: str) -> Optional[Dict[str, Any]]:
    """Lookup subject property by street address in opa_properties_public."""
    norm_addr = clean_address(address)
    parts = norm_addr.split(" ", 1)
    range_condition = ""
    if len(parts) == 2 and parts[0].isdigit():
        num, street = parts[0], parts[1]
        range_condition = f"OR (UPPER(p.location) LIKE '{num}-%' AND UPPER(p.location) LIKE '%{street}%')"

    query = f"""
    SELECT 
      p.*,
      ST_Y(p.the_geom) as lat,
      ST_X(p.the_geom) as lng
    FROM opa_properties_public p
    WHERE UPPER(p.location) = '{norm_addr}'
       OR UPPER(p.location) LIKE '{norm_addr}%'
       OR UPPER(p.location) LIKE '%{norm_addr}%'
       {range_condition}
    ORDER BY 
       CASE 
         WHEN UPPER(p.location) = '{norm_addr}' THEN 0 
         WHEN UPPER(p.location) LIKE '{norm_addr}%' THEN 1
         ELSE 2 
       END
    LIMIT 1
    """
    rows = execute_carto_query(query)
    if not rows:
        return None
    return rows[0]


def get_property_assessments(parcel_number: str) -> List[Dict[str, Any]]:
    """Fetch multi-year assessment records for a given parcel."""
    query = f"""
    SELECT *
    FROM assessments
    WHERE parcel_number = '{parcel_number}'
    ORDER BY year DESC
    """
    return execute_carto_query(query)


def get_matched_attributes(subject: Dict[str, Any], candidate: Dict[str, Any]) -> List[str]:
    """Identify which characteristics match or are close between subject and candidate."""
    matches = []

    # 1. Square footage comparison
    sub_sqft = float(subject.get("total_livable_area") or 0)
    cand_sqft = float(candidate.get("total_livable_area") or 0)
    if sub_sqft > 0 and cand_sqft > 0:
        diff_pct = ((cand_sqft - sub_sqft) / sub_sqft) * 100
        if abs(diff_pct) <= 3:
            matches.append(f"Exact SqFt ({cand_sqft:,.0f} vs {sub_sqft:,.0f})")
        elif abs(diff_pct) <= 15:
            matches.append(f"Similar SqFt ({cand_sqft:,.0f} sqft, {diff_pct:+.1f}%)")
        else:
            matches.append(f"SqFt: {cand_sqft:,.0f} ({diff_pct:+.1f}%)")

    # 2. Year Built / Era
    try:
        sub_yr = int(subject.get("year_built") or 0)
    except (ValueError, TypeError):
        sub_yr = 0
    try:
        cand_yr = int(candidate.get("year_built") or 0)
    except (ValueError, TypeError):
        cand_yr = 0

    if sub_yr > 0 and cand_yr > 0:
        yr_diff = abs(cand_yr - sub_yr)
        if yr_diff == 0:
            matches.append(f"Same Build Year ({cand_yr})")
        elif yr_diff <= 5:
            matches.append(f"Same Era ({cand_yr} vs {sub_yr})")
        elif (sub_yr >= 2010 and cand_yr >= 2010):
            matches.append(f"Modern Build ({cand_yr})")
        elif (sub_yr < 1940 and cand_yr < 1940):
            matches.append(f"Historic Build ({cand_yr})")
        else:
            matches.append(f"Built {cand_yr}")

    # 3. Stories
    cand_stories = candidate.get("number_stories")
    if cand_stories:
        matches.append(f"{cand_stories} Stories")

    # 4. Beds / Baths
    sub_beds = subject.get("number_of_bedrooms")
    cand_beds = candidate.get("number_of_bedrooms")
    sub_baths = subject.get("number_of_bathrooms")
    cand_baths = candidate.get("number_of_bathrooms")
    if cand_beds is not None and sub_beds is not None:
        if str(cand_beds) == str(sub_beds) and str(cand_baths) == str(sub_baths):
            matches.append(f"Exact Layout ({cand_beds}bd/{cand_baths}ba)")
        elif str(cand_beds) == str(sub_beds):
            matches.append(f"Same Beds ({cand_beds}bd)")

    # 5. Condition
    sub_cond = subject.get("exterior_condition")
    cand_cond = candidate.get("exterior_condition")
    cond_labels = {"1": "New/Rehab", "2": "Good", "3": "Average", "4": "Fair", "5": "Poor"}
    if sub_cond and cand_cond:
        if str(sub_cond) == str(cand_cond):
            matches.append(f"Same Condition ({cond_labels.get(str(cand_cond), cand_cond)})")

    # 6. Proximity
    dist_m = float(candidate.get("dist_meters") or 0)
    if dist_m <= 60:
        matches.append(f"Same Block ({dist_m:.0f}m)")
    elif dist_m <= 250:
        matches.append(f"Immediate Area ({dist_m:.0f}m)")
    else:
        matches.append(f"{dist_m:.0f}m away")

    return matches


def calculate_similarity_score(
    subject: Dict[str, Any],
    candidate: Dict[str, Any],
    weights: Dict[str, float] = None,
    dispute: bool = False,
    subject_pct_change: float = 0.0,
    subject_val_per_sqft: float = 0.0,
) -> Tuple[float, float, str]:
    """
    Calculate a composite similarity percentage (0-100%) and dispute score between subject and candidate.
    Returns (base_similarity, dispute_score, dispute_reason).
    """
    if weights is None:
        weights = {
            "sqft": 0.35,
            "year": 0.20,
            "stories": 0.15,
            "beds_baths": 0.10,
            "condition": 0.10,
            "distance": 0.10,
        }

    # 1. Square Footage Difference (relative difference)
    sub_sqft = float(subject.get("total_livable_area") or 1200)
    cand_sqft = float(candidate.get("total_livable_area") or sub_sqft)
    diff_sqft = abs(cand_sqft - sub_sqft) / max(sub_sqft, 500)
    score_sqft = max(0.0, 1.0 - diff_sqft)

    # 2. Year Built / Construction Era Difference
    try:
        sub_yr = int(subject.get("year_built") or 1950)
    except (ValueError, TypeError):
        sub_yr = 1950
    try:
        cand_yr = int(candidate.get("year_built") or sub_yr)
    except (ValueError, TypeError):
        cand_yr = sub_yr
    
    diff_yr = abs(cand_yr - sub_yr)
    score_yr = max(0.0, 1.0 - (diff_yr / 40.0))

    # 3. Number of Stories
    sub_stories = float(subject.get("number_stories") or 2)
    cand_stories = float(candidate.get("number_stories") or sub_stories)
    diff_stories = abs(cand_stories - sub_stories)
    score_stories = max(0.0, 1.0 - (diff_stories / 2.0))

    # 4. Bedrooms & Bathrooms
    sub_beds = float(subject.get("number_of_bedrooms") or 3)
    cand_beds = float(candidate.get("number_of_bedrooms") or sub_beds)
    sub_baths = float(subject.get("number_of_bathrooms") or 1)
    cand_baths = float(candidate.get("number_of_bathrooms") or sub_baths)
    diff_beds_baths = (abs(cand_beds - sub_beds) + abs(cand_baths - sub_baths)) / 4.0
    score_beds_baths = max(0.0, 1.0 - diff_beds_baths)

    # 5. Exterior Condition
    try:
        sub_cond = int(subject.get("exterior_condition") or 3)
    except (ValueError, TypeError):
        sub_cond = 3
    try:
        cand_cond = int(candidate.get("exterior_condition") or sub_cond)
    except (ValueError, TypeError):
        cand_cond = sub_cond
    diff_cond = abs(cand_cond - sub_cond) / 4.0
    score_cond = max(0.0, 1.0 - diff_cond)

    # 6. Geographic Distance
    dist_m = float(candidate.get("dist_meters") or 0.0)
    score_dist = max(0.0, 1.0 - (dist_m / 1200.0))

    base_sim = (
        weights["sqft"] * score_sqft
        + weights["year"] * score_yr
        + weights["stories"] * score_stories
        + weights["beds_baths"] * score_beds_baths
        + weights["condition"] * score_cond
        + weights["distance"] * score_dist
    )
    base_similarity_pct = round(max(0.0, min(100.0, base_sim * 100.0)), 1)

    # 7. Dispute Scoring Preference (Strictly Lower $/SqFt Assessed Value)
    dispute_reasons = []
    dispute_bonus = 0.0

    cand_v27 = candidate.get("val_2027")
    cand_sq = candidate.get("total_livable_area")
    cand_val_sqft = (cand_v27 / cand_sq) if (cand_v27 and cand_sq and cand_sq > 0) else None

    if dispute:
        if cand_val_sqft and subject_val_per_sqft > 0:
            diff_sqft_val = subject_val_per_sqft - cand_val_sqft
            diff_pct = (diff_sqft_val / subject_val_per_sqft) * 100

            if diff_sqft_val > 0:
                # Direct appeal evidence: Candidate property assessed at lower $/sqft than subject
                # Scaled bonus up to +40% score boost for significantly lower $/sqft
                sqft_val_bonus = min(0.40, (diff_sqft_val / subject_val_per_sqft) * 0.50)
                dispute_bonus += sqft_val_bonus
                dispute_reasons.append(f"Lower $/sqft (${cand_val_sqft:.1f} vs ${subject_val_per_sqft:.1f}, {diff_pct:+.1f}% lower)")

                # Extra evidence bonus if property has equal or larger square footage
                if cand_sqft >= sub_sqft:
                    dispute_bonus += 0.08
                    dispute_reasons.append(f"Equal/larger size ({cand_sqft:,.0f} sqft)")
            else:
                # Penalty if candidate has higher $/sqft (not helpful for a decrease appeal)
                penalty = min(0.35, (abs(diff_sqft_val) / subject_val_per_sqft) * 0.40)
                dispute_bonus -= penalty

    dispute_score = round(max(0.0, min(100.0, (base_sim + dispute_bonus) * 100.0)), 1)
    reason_str = " • ".join(dispute_reasons) if dispute_reasons else "Standard match"

    return base_similarity_pct, dispute_score, reason_str


def find_comparable_properties(
    subject: Dict[str, Any],
    limit: int = 15,
    max_radius_meters: float = 1200.0,
    preset: str = "balanced",
    dispute: bool = False,
    subject_pct_change: float = 0.0,
    subject_val_per_sqft: float = 0.0,
) -> List[Dict[str, Any]]:
    """Fetch nearby properties with latest 2026 and 2027 assessment values and rank by similarity/dispute."""
    lat = subject.get("lat")
    lng = subject.get("lng")
    parcel_num = subject.get("parcel_number")
    sub_sqft = float(subject.get("total_livable_area") or 1500)

    # Tolerances based on preset
    sqft_min = max(400, int(sub_sqft * 0.40))
    sqft_max = int(sub_sqft * 1.85)

    query = f"""
    SELECT 
      p.location, 
      p.parcel_number, 
      p.total_livable_area, 
      p.total_area,
      p.number_stories, 
      p.number_of_bedrooms, 
      p.number_of_bathrooms, 
      p.number_of_rooms,
      p.year_built,
      p.building_code_description,
      p.exterior_condition,
      p.interior_condition,
      p.zoning,
      p.category_code_description,
      p.sale_date,
      p.sale_price,
      ST_Y(p.the_geom) as lat, 
      ST_X(p.the_geom) as lng,
      ROUND(ST_Distance(p.the_geom::geography, ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326)::geography)::numeric, 1) as dist_meters,
      a27.market_value as val_2027,
      a27.taxable_building as taxable_building_2027,
      a27.exempt_building as exempt_building_2027,
      a27.taxable_land as taxable_land_2027,
      a26.market_value as val_2026,
      ROUND(((a27.market_value - a26.market_value)::numeric / NULLIF(a26.market_value, 0)::numeric) * 100, 2) as pct_change
    FROM opa_properties_public p
    LEFT JOIN assessments a27 ON a27.parcel_number = p.parcel_number AND a27.year = '2027'
    LEFT JOIN assessments a26 ON a26.parcel_number = p.parcel_number AND a26.year = '2026'
    WHERE p.parcel_number != '{parcel_num}'
      AND p.total_livable_area BETWEEN {sqft_min} AND {sqft_max}
      AND ST_DWithin(p.the_geom::geography, ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326)::geography, {max_radius_meters})
    ORDER BY dist_meters ASC
    LIMIT 150
    """

    candidates = execute_carto_query(query)
    
    # Custom weights for preset
    weights = None
    if preset == "era":
        weights = {"sqft": 0.25, "year": 0.40, "stories": 0.15, "beds_baths": 0.05, "condition": 0.05, "distance": 0.10}
    elif preset == "proximity":
        weights = {"sqft": 0.25, "year": 0.15, "stories": 0.10, "beds_baths": 0.05, "condition": 0.05, "distance": 0.40}
    elif preset == "layout":
        weights = {"sqft": 0.45, "year": 0.10, "stories": 0.20, "beds_baths": 0.15, "condition": 0.05, "distance": 0.05}

    for cand in candidates:
        sim, disp_score, disp_reason = calculate_similarity_score(
            subject,
            cand,
            weights=weights,
            dispute=dispute,
            subject_pct_change=subject_pct_change,
            subject_val_per_sqft=subject_val_per_sqft,
        )
        cand["similarity_score"] = sim
        cand["dispute_score"] = disp_score
        cand["dispute_reason"] = disp_reason
        cand["matched_attributes"] = get_matched_attributes(subject, cand)

        v27 = cand.get("val_2027")
        sq = cand.get("total_livable_area")
        if v27 and sq and sq > 0:
            cand["val_per_sqft_2027"] = round(v27 / sq, 1)
        else:
            cand["val_per_sqft_2027"] = None

    # Sort candidates: if dispute=True, rank by dispute_score, else similarity_score
    sort_key = "dispute_score" if dispute else "similarity_score"
    candidates.sort(key=lambda x: x[sort_key], reverse=True)
    return candidates[:limit]


def generate_analysis_summary(
    subject: Dict[str, Any],
    subject_hist: List[Dict[str, Any]],
    comps: List[Dict[str, Any]],
    dispute: bool = False,
) -> Dict[str, Any]:
    """Calculate summary statistics, anomaly metrics, and estimated fair value."""
    val_2027 = None
    val_2026 = None
    for rec in subject_hist:
        if str(rec.get("year")) == "2027":
            val_2027 = float(rec.get("market_value") or 0)
        elif str(rec.get("year")) == "2026":
            val_2026 = float(rec.get("market_value") or 0)

    if val_2027 is None:
        val_2027 = float(subject.get("market_value") or 0)

    sub_sqft = float(subject.get("total_livable_area") or 1)
    sub_pct_change = (
        round(((val_2027 - val_2026) / val_2026) * 100, 2)
        if (val_2026 and val_2026 > 0)
        else 0.0
    )
    sub_val_per_sqft = round(val_2027 / sub_sqft, 2) if sub_sqft > 0 else 0.0

    # Comps statistics
    pct_changes = [
        float(c["pct_change"]) for c in comps if c.get("pct_change") is not None
    ]
    sqft_values = [
        float(c["val_per_sqft_2027"])
        for c in comps
        if c.get("val_per_sqft_2027") is not None
    ]

    median_pct = (
        round(sorted(pct_changes)[len(pct_changes) // 2], 2)
        if pct_changes
        else 0.0
    )
    mean_pct = (
        round(sum(pct_changes) / len(pct_changes), 2) if pct_changes else 0.0
    )
    median_val_sqft = (
        round(sorted(sqft_values)[len(sqft_values) // 2], 2)
        if sqft_values
        else 0.0
    )
    mean_val_sqft = (
        round(sum(sqft_values) / len(sqft_values), 2) if sqft_values else 0.0
    )

    # Percentile of subject increase among comps
    lower_count = sum(1 for p in pct_changes if p < sub_pct_change)
    percentile = (
        round((lower_count / len(pct_changes)) * 100, 1)
        if pct_changes
        else 100.0
    )

    # Fair value projections
    proj_val_by_median_pct = (
        val_2026 * (1 + median_pct / 100.0) if val_2026 else val_2027
    )
    proj_val_by_median_sqft = median_val_sqft * sub_sqft

    # In dispute mode, target assessment is based on the cohort's median $/sqft
    proj_target = proj_val_by_median_sqft if dispute else proj_val_by_median_pct
    potential_overassessment = max(0, val_2027 - proj_target)

    return {
        "subject_val_2027": val_2027,
        "subject_val_2026": val_2026,
        "subject_pct_change": sub_pct_change,
        "subject_val_per_sqft": sub_val_per_sqft,
        "median_comps_pct_change": median_pct,
        "mean_comps_pct_change": mean_pct,
        "median_comps_val_sqft": median_val_sqft,
        "mean_comps_val_sqft": mean_val_sqft,
        "increase_percentile": percentile,
        "proj_val_by_median_pct": round(proj_val_by_median_pct),
        "proj_val_by_median_sqft": round(proj_val_by_median_sqft),
        "proj_target": round(proj_target),
        "potential_overassessment": round(potential_overassessment),
        "num_comps": len(comps),
        "dispute_mode": dispute,
    }


def print_cli_report(
    subject: Dict[str, Any],
    stats: Dict[str, Any],
    comps: List[Dict[str, Any]],
):
    """Print an ANSI formatted report in the terminal with matched attributes and dispute details."""
    sep = "=" * 105
    sub_sep = "-" * 105

    print("\n" + sep)
    mode_tag = " [*** TAX APPEAL / DISPUTE MODE ACTIVE ***]" if stats.get("dispute_mode") else ""
    print(f" PHILADELPHIA OPA PROPERTY ASSESSMENT & COMPARABLES ANALYSIS{mode_tag}")
    print(sep)
    print(f" Subject Property:    {subject.get('location')} (Parcel #{subject.get('parcel_number')})")
    print(f" Category / Zoning:   {subject.get('category_code_description')} | Zoning: {subject.get('zoning')}")
    print(f" Characteristics:     {subject.get('total_livable_area')} sqft | {subject.get('number_stories')} Stories | {subject.get('number_of_bedrooms')} Beds / {subject.get('number_of_bathrooms')} Baths | Built {subject.get('year_built')}")
    print(f" Condition / Ward:    Exterior Cond: {subject.get('exterior_condition')} | Ward: {subject.get('geographic_ward')}, Tract: {subject.get('census_tract')}")
    print(sub_sep)
    print(f" 2026 Market Value:   ${stats['subject_val_2026']:>10,.0f}")
    print(f" 2027 Market Value:   ${stats['subject_val_2027']:>10,.0f}  (Change: {stats['subject_pct_change']:+.2f}%)")
    print(f" 2027 Assessed $/SqFt: ${stats['subject_val_per_sqft']:>9.2f} / sqft")
    print(sub_sep)
    print(" [COHORT COMPARISON & TAX APPEAL EVIDENCE]")
    print(f" * Comparable Homes:  {stats['num_comps']} dynamic matches found" + (" (preferencing appeal dispute comps)" if stats.get("dispute_mode") else ""))
    print(f" * Median Cohort Change: {stats['median_comps_pct_change']:+.2f}%  (Average: {stats['mean_comps_pct_change']:+.2f}%)")
    print(f" * Median Assessed $/SqFt: ${stats['median_comps_val_sqft']:.2f} / sqft  (Average: ${stats['mean_comps_val_sqft']:.2f})")
    print(f" * Assessment Anomaly: Your increase of {stats['subject_pct_change']:+.2f}% is higher than {stats['increase_percentile']}% of similar properties!")
    if stats["potential_overassessment"] > 0:
        print(f" * Est. Over-Assessment: ~${stats['potential_overassessment']:,.0f} (Target Assessment: ~${stats['proj_target']:,.0f})")
    print(sep)
    
    score_col_name = "DisputeScore" if stats.get("dispute_mode") else "Similarity"
    print(f"{'#':<3} {score_col_name:<13} {'Address':<24} {'SqFt':<6} {'Yr':<5} {'Sty':<4} {'2026 Val':<12} {'2027 Val':<12} {'Change':<9} {'$/SqFt':<8} {'Dist':<6}")
    print(sub_sep)

    for i, c in enumerate(comps, 1):
        score_val = c.get("dispute_score") if stats.get("dispute_mode") else c.get("similarity_score")
        score_str = f"{score_val:.1f}%"
        loc = (c.get("location") or "")[:23]
        sq = f"{c.get('total_livable_area') or 0}"
        yr = f"{c.get('year_built') or 'N/A'}"
        sty = f"{c.get('number_stories') or 'N/A'}"
        v26 = f"${c.get('val_2026'):,.0f}" if c.get("val_2026") is not None else "N/A"
        v27 = f"${c.get('val_2027'):,.0f}" if c.get("val_2027") is not None else "N/A"
        chg = f"{c.get('pct_change'):+.2f}%" if c.get("pct_change") is not None else "N/A"
        psq = f"${c.get('val_per_sqft_2027'):.1f}" if c.get("val_per_sqft_2027") is not None else "N/A"
        dst = f"{c.get('dist_meters'):.0f}m"
        print(f"{i:<3} {score_str:<13} {loc:<24} {sq:<6} {yr:<5} {sty:<4} {v26:<12} {v27:<12} {chg:<9} {psq:<8} {dst:<6}")
        
        # Print Matched Attributes
        matched_attrs = " | ".join(c.get("matched_attributes", []))
        print(f"    └─ Matched Attributes: {matched_attrs}")
        if stats.get("dispute_mode") and c.get("dispute_reason"):
            print(f"    └─ Appeal Evidence:   [✓ {c['dispute_reason']}]")
        print()
    print(sep + "\n")


def export_csv(
    filename: str,
    subject: Dict[str, Any],
    stats: Dict[str, Any],
    comps: List[Dict[str, Any]],
):
    """Export comparison report and comps dataset to CSV with matched attributes and appeal reasoning."""
    import csv

    with open(filename, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Philadelphia OPA Assessment Appeal Comps Evidence"])
        writer.writerow(["Subject Address", subject.get("location")])
        writer.writerow(["Parcel Number", subject.get("parcel_number")])
        writer.writerow(["Livable SqFt", subject.get("total_livable_area")])
        writer.writerow(["Year Built", subject.get("year_built")])
        writer.writerow(["2026 Market Value", stats["subject_val_2026"]])
        writer.writerow(["2027 Market Value", stats["subject_val_2027"]])
        writer.writerow(["Assessment Change %", f"{stats['subject_pct_change']}%"])
        writer.writerow(["Comps Median Change %", f"{stats['median_comps_pct_change']}%"])
        writer.writerow(["Est. Over-Assessment ($)", stats["potential_overassessment"]])
        writer.writerow(["Dispute Mode Active", stats.get("dispute_mode", False)])
        writer.writerow([])
        writer.writerow([
            "Rank",
            "Similarity Score (%)",
            "Dispute Score (%)",
            "Address",
            "Parcel Number",
            "Distance (meters)",
            "Livable SqFt",
            "Stories",
            "Bedrooms",
            "Bathrooms",
            "Year Built",
            "Condition",
            "2026 Value ($)",
            "2027 Value ($)",
            "Change (%)",
            "2027 Value / SqFt ($)",
            "Matched Attributes",
            "Appeal Evidence / Dispute Reason",
            "Atlas Link",
        ])
        for i, c in enumerate(comps, 1):
            writer.writerow([
                i,
                c.get("similarity_score"),
                c.get("dispute_score"),
                c.get("location"),
                c.get("parcel_number"),
                c.get("dist_meters"),
                c.get("total_livable_area"),
                c.get("number_stories"),
                c.get("number_of_bedrooms"),
                c.get("number_of_bathrooms"),
                c.get("year_built"),
                c.get("exterior_condition"),
                c.get("val_2026"),
                c.get("val_2027"),
                c.get("pct_change"),
                c.get("val_per_sqft_2027"),
                "; ".join(c.get("matched_attributes", [])),
                c.get("dispute_reason", ""),
                f"https://atlas.phila.gov/#/{c.get('parcel_number')}/property",
            ])
    print(f"Exported evidence CSV to: {filename}")


def main():
    parser = argparse.ArgumentParser(
        description="Philadelphia Property Assessment & Dynamic Comps Analyzer"
    )
    parser.add_argument(
        "address",
        nargs="?",
        default=None,
        help="Street address to analyze (e.g. '1000 N BROAD ST')",
    )
    parser.add_argument(
        "--matches", "-n",
        type=int,
        default=10,
        help="Number of closest matching comps to return (default: 10)",
    )
    parser.add_argument(
        "--radius", "-r",
        type=float,
        default=1000.0,
        help="Max search radius in meters (default: 1000)",
    )
    parser.add_argument(
        "--preset", "-p",
        choices=["balanced", "era", "proximity", "layout"],
        default="balanced",
        help="Matching weighting preset (default: balanced)",
    )
    parser.add_argument(
        "--dispute", "-d",
        action="store_true",
        help="Dispute Mode: preference comps with lower assessed $/sqft to build tax appeal evidence",
    )
    parser.add_argument(
        "--export", "-e",
        type=str,
        help="Export comps results to CSV file path",
    )

    args = parser.parse_args()

    address = args.address
    if not address:
        try:
            address = input("Enter Philadelphia street address to analyze: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAnalysis cancelled.")
            sys.exit(0)
        if not address:
            print("Error: No street address provided. Usage: python opa_comps.py <address>", file=sys.stderr)
            sys.exit(1)

    print(f"Looking up property: {address}...")
    subject = get_property_by_address(address)
    if not subject:
        print(f"Could not find property with address matching '{address}'. Please check spelling.", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching historical assessments for parcel #{subject.get('parcel_number')}...")
    hist = get_property_assessments(subject.get("parcel_number"))

    # Determine subject assessment change & $/sqft
    val_2027 = None
    val_2026 = None
    for rec in hist:
        if str(rec.get("year")) == "2027":
            val_2027 = float(rec.get("market_value") or 0)
        elif str(rec.get("year")) == "2026":
            val_2026 = float(rec.get("market_value") or 0)
    if val_2027 is None:
        val_2027 = float(subject.get("market_value") or 0)

    sub_sqft = float(subject.get("total_livable_area") or 1)
    sub_pct = round(((val_2027 - val_2026) / val_2026) * 100, 2) if (val_2026 and val_2026 > 0) else 0.0
    sub_val_sqft = round(val_2027 / sub_sqft, 2) if sub_sqft > 0 else 0.0

    print(f"Finding closest {args.matches} comparable parcels within {args.radius}m" + (" [DISPUTE MODE ENABLED]" if args.dispute else "") + "...")
    comps = find_comparable_properties(
        subject,
        limit=args.matches,
        max_radius_meters=args.radius,
        preset=args.preset,
        dispute=args.dispute,
        subject_pct_change=sub_pct,
        subject_val_per_sqft=sub_val_sqft,
    )

    stats = generate_analysis_summary(subject, hist, comps, dispute=args.dispute)
    print_cli_report(subject, stats, comps)

    if args.export:
        export_csv(args.export, subject, stats, comps)


if __name__ == "__main__":
    main()
