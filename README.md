# Philadelphia Property Assessment & Dynamic Comps Explorer

An interactive web application and command-line tool to analyze Philadelphia property assessments using official live data from the **City of Philadelphia Office of Property Assessment (OPA)** via Carto SQL API endpoints.

Dynamically finds the closest comparable properties (based on square footage, building stories, bedrooms/bathrooms, year built/construction era, and spatial proximity) to determine whether a recent assessment spike (such as a 30% increase) is an outlier, and generates official tax appeal evidence documentation.

---

## 🚀 Key Features

1. **Direct Integration with Philadelphia OPA OpenData**:
   - Queries `opa_properties_public` (property characteristics, zoning, square footage, building codes) and `assessments` (multi-year historical assessments up to 2027) via live PostGIS SQL API.
2. **Dynamic Multivariate Matching Engine**:
   - Computes normalized feature distance across **Livable Square Feet**, **Number of Stories**, **Bedrooms / Bathrooms**, **Year Built / Era**, **Exterior Condition**, and **Geographic Distance**.
   - Includes preset matching modes: *Balanced Comps*, *Same Era / Modern Construction*, *Immediate Block*, and *Exact Size & Layout*.
3. **Assessment Anomaly & Fairness Meter**:
   - Computes the cohort median and mean % assessment change and assessed $/sqft.
   - Calculates your assessment increase percentile relative to comparable homes (e.g. 100th percentile outlier).
   - Estimates potential over-assessment disparity for tax appeal filings.
4. **Interactive Leaflet Map**:
   - Shows subject property (gold/purple star) with color-coded comparable property pins (green for decreases/flat, yellow for moderate, red for high).
   - Clickable popups with full property specs and direct links to the official [Philadelphia Atlas](https://atlas.phila.gov/).
5. **Interactive Data Visualizations (Chart.js)**:
   - % Assessment change bar chart.
   - Multi-year assessment history trend line (2015–2027).
   - Livable Area vs Market Value scatter plot with subject position.
6. **Official Appeal Evidence Generator & CSV Export**:
   - One-click formatted **Property Assessment Appeal Evidence Summary** ready to print or save to PDF for submission to the Philadelphia Board of Revision of Taxes (BRT) or OPA First Level Review (FLR).
   - One-click CSV export with all comparable property specs and URLs.

---

## 💻 Quick Start

### 1. Launch the Web Application

To run the interactive web applet locally:

```bash
# Start the local server (auto-opens in your browser)
python serve.py
```
Or open `index.html` directly in any modern browser.

### 2. Run the Command-Line Analysis Tool (`opa_comps.py`)

You can run automated comparative assessments directly from your terminal:

```bash
# Analyze an address interactively or by passing the address argument
python opa_comps.py "1629 CHRISTIAN ST" --dispute

# Analyze with custom match count and radius in dispute mode and export CSV
python opa_comps.py "1629 CHRISTIAN ST" --matches 10 --radius 1000 --dispute --export appeal_comps.csv

# Use a specific weighting preset: balanced, era, proximity, layout
python opa_comps.py "1000 S BROAD ST" --matches 15 --preset era --dispute
```

#### CLI Options:
- `address`: Street address to search (e.g. `"1629 CHRISTIAN ST"` or `"1000 N BROAD ST"`)
- `--dispute`, `-d`: **Dispute Mode (Appeal Preference)**: Preferences comps with lower assessed $/sqft to build strong evidence for a tax assessment decrease.
- `--matches`, `-n`: Number of closest matches to return (default: `10`)
- `--radius`, `-r`: Maximum geographic radius in meters (default: `1000`)
- `--preset`, `-p`: Weighting preset (`balanced`, `era`, `proximity`, `layout`)
- `--export`, `-e`: CSV output file path with matched attributes and dispute reasoning

---

## 📊 Example Case Study: `1629 CHRISTIAN ST`

- **Subject Property**: 2,655 sqft, Built 1915, Multi-Family (Graduate Hospital / 19146).
- **2026 Assessment**: $736,400
- **2027 Assessment**: $841,100 (**+14.22%** increase)
- **Cohort Analysis (Closest Matching Comps within 100m)**:
  - `1610 CATHARINE ST` (2,648 sqft, Built 1915): **+10.38%** ($617.4k → $681.5k)
  - `1705 CHRISTIAN ST` (2,616 sqft, Built 1915): **-0.58%** ($797.4k → $792.8k)
- **Findings**:
  - Cohort Median Assessment $/sqft: **$280.25 / sqft**.
  - Dynamic matching highlights disparity in $/sqft and assessment increases across neighboring homes.

---

## 🏛️ How to Use for a Philadelphia Assessment Appeal

1. **OPA First Level Review (FLR)**:
   - When Philadelphia issues new assessment notices, property owners can submit an informal First Level Review directly to the OPA.
   - Use the **"Generate Appeal Packet"** button in the web app to print or save the summary of your closest comps.
2. **Formal Appeal to the Board of Revision of Taxes (BRT)**:
   - If the First Level Review is not resolved or if filing a formal appeal before the annual deadline (typically the first Monday in October), attach the generated evidence packet and CSV.
   - Ground your appeal in the **Pennsylvania Constitution Uniformity Clause (Art. VIII, § 1)** demonstrating that your property has been assessed at a significantly higher rate of increase and value per square foot than comparable properties of the same class and neighborhood.

---

## 🛠️ Data Sources
- **OPA Properties**: [City of Philadelphia Carto API Explorer - `opa_properties_public`](https://cityofphiladelphia.github.io/carto-api-explorer/#opa_properties_public)
- **Historical Assessments**: [City of Philadelphia Carto API Explorer - `assessments`](https://cityofphiladelphia.github.io/carto-api-explorer/#assessments)
- **Philadelphia Atlas**: [atlas.phila.gov](https://atlas.phila.gov/)
