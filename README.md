# Philadelphia Property Assessment & Dynamic Comps Explorer

An interactive web application and command-line analysis tool to investigate Philadelphia property assessments and build tax appeal evidence using official, live data from the **City of Philadelphia Office of Property Assessment (OPA)** via Carto SQL API endpoints.

Dynamically finds the closest comparable properties based on multivariate physical characteristics (square footage, building stories, bedrooms/bathrooms, year built/construction era, and spatial proximity) to determine whether a recent assessment is an outlier, and generates official tax appeal evidence documentation.

---

## 🚀 Key Features

1. **Direct Integration with Philadelphia OPA OpenData**:
   - Queries `opa_properties_public` (property characteristics, zoning, square footage, building codes) and `assessments` (multi-year historical assessments up to 2027) via live PostGIS SQL queries.
   - Zero backend required — runs entirely client-side in the browser or via Python CLI.
2. **Dynamic Multivariate Matching Engine**:
   - Computes normalized feature distance across **Livable Square Feet**, **Number of Stories**, **Bedrooms / Bathrooms**, **Year Built / Era**, **Exterior Condition**, and **Geographic Distance**.
   - Includes preset matching modes: *Balanced Comps*, *Same Era / Modern Build*, *Immediate Block*, and *Exact Size & Layout*.
3. **Dispute Mode (Tax Appeal Preference)**:
   - Preferences comparable properties with **lower assessed value per square foot ($\$/\text{sqft}$)** and equal/larger size to construct rigorous legal evidence under the **Pennsylvania Constitution Uniformity Clause**.
4. **Assessment Anomaly & Disparity Meter**:
   - Computes the cohort median and mean % assessment change and assessed $/sqft.
   - Calculates your assessment percentile relative to comparable homes (e.g. 100th percentile outlier).
   - Estimates equitable valuation targets and dollar over-assessment disparities for tax appeal filings.
5. **Interactive Leaflet Map & Visualizations (Chart.js)**:
   - Interactive map with color-coded property pins, radius overlay, and direct links to the official [Philadelphia Atlas](https://atlas.phila.gov/).
   - % Assessment change comparison bar chart, multi-year historical assessment trajectories (2015–2027), and Livable Area vs Market Value scatter plots.
6. **Official Appeal Evidence Generator & CSV Export**:
   - One-click formatted **Property Assessment Appeal Evidence Summary** ready to print or save to PDF for submission to the Philadelphia Board of Revision of Taxes (BRT) or OPA First Level Review (FLR).
   - One-click CSV export with all comparable property specs, matched attributes, and URLs.

---

## 🎯 Matching Modes & Presets

The application supports four distinct physical matching presets plus a specialized **Dispute Mode**:

```
                                  MATCHING PRESETS
 ┌───────────────────────────┬────────────────────────────────────────────────────────┐
 │ Preset Mode               │ Primary Focus & Ideal Use Case                         │
 ├───────────────────────────┼────────────────────────────────────────────────────────┤
 │ ⚖️ Balanced Comps         │ General-purpose valuation across all 6 physical and    │
 │   (Default)               │ spatial dimensions.                                    │
 ├───────────────────────────┼────────────────────────────────────────────────────────┤
 │ 🏗️ Same Era / Modern      │ Heavily weights construction year (40%). Ideal for     │
 │   Build                   │ newly constructed homes (2015+) or historic rowhomes.  │
 ├───────────────────────────┼────────────────────────────────────────────────────────┤
 │ 📍 Immediate Block        │ Heavily weights geographic proximity (40%). Ideal for  │
 │                           │ hyper-local comps within 1–2 blocks of the property.   │
 ├───────────────────────────┼────────────────────────────────────────────────────────┤
 │ 📐 Exact Size & Layout    │ Heavily weights livable area (45%), stories (20%), and │
 │                           │ bedroom/bathroom counts (15%).                         │
 ├───────────────────────────┼────────────────────────────────────────────────────────┤
 │ 🛡️ Dispute Mode           │ Re-ranks comps to preference properties assessed at a  │
 │   (Appeal Preference)     │ lower $/sqft and larger size to maximize appeal power. │
 └───────────────────────────┴────────────────────────────────────────────────────────┘
```

### 1. Balanced Comps (`balanced`)
The standard default configuration. Distributes weight harmoniously across square footage ($35\%$), year built ($20\%$), building height ($15\%$), layout ($10\%$), condition ($10\%$), and distance ($10\%$).

### 2. Same Era / Modern Build (`era`)
Increases the year built weight to **$40\%$**. In Philadelphia neighborhoods undergoing rapid revitalization (e.g. Fishtown, Point Breeze, Kensington), modern rowhomes built under the 10-year tax abatement have vastly different market and assessment dynamics than 100-year-old historic brick rowhomes on the same block. This preset ensures modern homes are matched to modern peers.

### 3. Immediate Block (`proximity`)
Increases geographic distance weight to **$40\%$** and reduces the search radius influence. Best when establishing hyper-local baseline values on the exact same street or adjacent corner parcels.

### 4. Exact Size & Layout (`layout`)
Allocates **$80\%$** of total weight to physical building dimensions ($45\%$ Livable Area, $20\%$ Stories, $15\%$ Beds/Baths). Ensures that only properties of nearly identical architectural footprint and room counts are matched.

### 5. Dispute Mode (`--dispute` / Toggle)
When preparing an assessment appeal before the Board of Revision of Taxes (BRT), the taxpayer must demonstrate non-uniformity. Dispute Mode adjusts the composite score by giving substantial priority boosts to properties with **lower assessed $\$/\text{sqft}$**, while penalizing higher $\$/\text{sqft}$ properties that would inflate the cohort average.

---

## 📐 Mathematical Formulation & Matching Algorithms

### 1. Multivariate Feature Normalization

For each candidate property $c$ relative to subject property $s$, univariate similarity scores $S_k \in [0, 1]$ are calculated across 6 dimensions:

#### A. Total Livable Area ($\text{SqFt}$) Similarity
Computes the relative square footage difference normalized by the subject's area (with a $500\text{ sqft}$ floor):
$$S_{\text{sqft}} = \max\left(0, 1 - \frac{|\text{SqFt}_c - \text{SqFt}_s|}{\max(\text{SqFt}_s, 500)}\right)$$

#### B. Construction Era ($\text{Year Built}$) Similarity
Penalizes age disparity over a 40-year normalization window:
$$S_{\text{year}} = \max\left(0, 1 - \frac{|\text{Year}_c - \text{Year}_s|}{40}\right)$$

#### C. Building Height ($\text{Stories}$) Similarity
Penalizes story differences over a 2-story scale:
$$S_{\text{stories}} = \max\left(0, 1 - \frac{|\text{Stories}_c - \text{Stories}_s|}{2}\right)$$

#### D. Bedroom & Bathroom Layout Similarity
Measures room count disparity normalized across 4 total rooms:
$$S_{\text{layout}} = \max\left(0, 1 - \frac{|\text{Beds}_c - \text{Beds}_s| + |\text{Baths}_c - \text{Baths}_s|}{4}\right)$$

#### E. Exterior Condition Similarity
OPA condition codes range from 1 (New/Rehabbed) to 6 (Vacant). Differences are normalized over the 4-point active scale:
$$S_{\text{cond}} = \max\left(0, 1 - \frac{|\text{Cond}_c - \text{Cond}_s|}{4}\right)$$

#### F. Spatial Geographic Distance Similarity
Measures spherical distance $D_m$ in meters relative to the maximum search radius $R_{\text{max}}$:
$$S_{\text{dist}} = \max\left(0, 1 - \frac{D_m}{R_{\text{max}} \times 1.1}\right)$$

---

### 2. Preset Weight Matrix

The base composite similarity percentage is computed as the weighted linear combination of the normalized feature scores:

$$\text{Base Similarity (\%)} = \left(\sum_{k \in \mathcal{F}} w_k \cdot S_k\right) \times 100\%$$

| Feature ($k$) | Balanced ($w_{\text{bal}}$) | Same Era ($w_{\text{era}}$) | Proximity ($w_{\text{prox}}$) | Strict Layout ($w_{\text{lay}}$) |
|---|:---:|:---:|:---:|:---:|
| **Livable Area ($\text{SqFt}$)** | $0.35$ | $0.25$ | $0.25$ | $0.45$ |
| **Year Built ($\text{Year}$)** | $0.20$ | $0.40$ | $0.15$ | $0.10$ |
| **Building Stories ($\text{Stories}$)** | $0.15$ | $0.15$ | $0.10$ | $0.20$ |
| **Beds / Baths ($\text{Layout}$)** | $0.10$ | $0.05$ | $0.05$ | $0.15$ |
| **Condition ($\text{Cond}$)** | $0.10$ | $0.05$ | $0.05$ | $0.05$ |
| **Geographic Distance ($\text{Dist}$)** | $0.10$ | $0.10$ | $0.40$ | $0.05$ |
| **Sum of Weights ($\sum w$)** | **$1.00$** | **$1.00$** | **$1.00$** | **$1.00$** |

---

### 3. Dispute Mode Scoring Formula

When Dispute Mode is enabled, the algorithm computes the relative disparity in 2027 assessed value per square foot:

$$(\$/\text{sqft})_s = \frac{\text{MarketValue}_{2027, s}}{\text{SqFt}_s}, \quad (\$/\text{sqft})_c = \frac{\text{MarketValue}_{2027, c}}{\text{SqFt}_c}$$

$$\Delta_{\$/\text{sqft}} = \frac{(\$/\text{sqft})_s - (\$/\text{sqft})_c}{(\$/\text{sqft})_s}$$

- **Lower $\$/\text{SqFt}$ Bonus** ($\Delta > 0$): Comp is assessed at a lower rate per square foot than the subject:
  $$\text{Bonus} = \min\left(0.40, \Delta_{\$/\text{sqft}} \times 0.50\right) + \begin{cases} 0.08 & \text{if } \text{SqFt}_c \ge \text{SqFt}_s \\ 0 & \text{otherwise} \end{cases}$$
- **Higher $\$/\text{SqFt}$ Penalty** ($\Delta \le 0$): Comp is assessed at a higher rate per square foot:
  $$\text{Penalty} = \min\left(0.35, |\Delta_{\$/\text{sqft}}| \times 0.40\right)$$

$$\text{Dispute Score} = \min\left(100\%, \max\left(0\%, \left(\sum w_k S_k + \text{Bonus} - \text{Penalty}\right) \times 100\%\right)\right)$$

---

### 4. Valuation Target & Disparity Math

The equitable valuation target and potential over-assessment disparity are derived directly from the cohort's statistical distribution:

$$\text{Target Valuation}_{\text{Dispute}} = \text{SqFt}_s \times \text{Median}\left(\left\{(\$/\text{sqft})_{c_1}, \dots, (\$/\text{sqft})_{c_N}\right\}\right)$$

$$\text{Over-Assessment Disparity} = \max\left(0, \text{MarketValue}_{2027, s} - \text{Target Valuation}\right)$$

---

## 💻 Quick Start

### 1. Run the Interactive Web Application

Open `index.html` directly in any web browser, or launch via the included zero-dependency Python local server:

```powershell
python serve.py
```
*Navigates automatically to `http://localhost:8000/index.html`.*

### 2. Run the Python CLI Tool (`opa_comps.py`)

Run automated comparative assessments and export CSV reports directly from your terminal:

```powershell
# Analyze an address with Dispute Mode enabled
python opa_comps.py "1629 CHRISTIAN ST" --dispute

# Custom match count and radius with CSV export
python opa_comps.py "1629 CHRISTIAN ST" --matches 10 --radius 1000 --dispute --export "appeal_comps.csv"

# Use specific weighting presets: balanced, era, proximity, layout
python opa_comps.py "1000 N BROAD ST" --matches 15 --preset era --dispute
```

#### CLI Options:
- `address`: Street address to search (e.g. `"1629 CHRISTIAN ST"` or `"1000 N BROAD ST"`)
- `--dispute`, `-d`: **Dispute Mode**: Preferences comps with lower assessed $/sqft to build tax appeal evidence.
- `--matches`, `-n`: Number of closest matching comps to return (default: `10`)
- `--radius`, `-r`: Maximum geographic radius in meters (default: `1000`)
- `--preset`, `-p`: Weighting preset (`balanced`, `era`, `proximity`, `layout`)
- `--export`, `-e`: CSV output file path

---

## 📊 Example Case Study: `1629 CHRISTIAN ST`

- **Subject Property**: 2,655 sqft, Built 1915, Multi-Family (Graduate Hospital / 19146).
- **2026 Assessment**: $736,400
- **2027 Assessment**: $841,100 (**+14.22%** increase)
- **Assessed Rate**: **$316.80 / sqft**
- **Cohort Analysis (Closest Matching Comps within 100m)**:
  - `1610 CATHARINE ST` (2,648 sqft, Built 1915): **$257.40 / sqft** ($681.5k) — *-18.8% lower rate*
  - `1705 CHRISTIAN ST` (2,616 sqft, Built 1915): **$303.10 / sqft** ($792.8k) — *-4.3% lower rate*
- **Findings**:
  - Cohort Median Assessed $/SqFt: **$280.25 / sqft**.
  - Equitable Target Assessment: **~$744,064**.
  - Estimated Over-Assessment Disparity: **~$97,036**.

---

## 🏛️ How to Use for a Philadelphia Assessment Appeal

1. **OPA First Level Review (FLR)**:
   - When Philadelphia issues new assessment notices, property owners can submit an informal First Level Review directly to the OPA.
   - Use the **"Generate Appeal Packet"** button in the web app to print or save the evidence summary of your closest comps.
2. **Formal Appeal to the Board of Revision of Taxes (BRT)**:
   - If the First Level Review is not resolved or if filing a formal appeal before the annual deadline (the first Monday in October), attach the generated evidence packet and CSV.
   - Ground your appeal in the **Pennsylvania Constitution Uniformity Clause (Art. VIII, § 1)**, demonstrating that your property has been assessed at a higher value per square foot than comparable properties of the same class and neighborhood.

---

## 🌐 Free Hosting via GitHub Pages

This app is 100% client-side and requires no server. You can host it for free on GitHub Pages:
1. Create a public repository on GitHub (e.g. `phila-property-assessments`).
2. Upload `index.html`, `styles.css`, `app.js`, and `README.md`.
3. Go to **Settings $\to$ Pages**, select the `main` branch, and click **Save**.
4. Your app will be live at `https://<your-username>.github.io/phila-property-assessments/`.

---

## 🛠️ Data Sources
- **OPA Properties Public**: [City of Philadelphia Carto API Explorer - `opa_properties_public`](https://cityofphiladelphia.github.io/carto-api-explorer/#opa_properties_public)
- **Historical Assessments**: [City of Philadelphia Carto API Explorer - `assessments`](https://cityofphiladelphia.github.io/carto-api-explorer/#assessments)
- **Philadelphia Atlas**: [atlas.phila.gov](https://atlas.phila.gov/)
