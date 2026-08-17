/**
 * Philadelphia Property Assessment & Dynamic Comps Explorer
 * Client Application Logic with Dispute Mode & Attribute Matching
 */

// Carto SQL API Configuration
const CARTO_SQL_URL = 'https://phl.carto.com/api/v2/sql';

// State Store
const state = {
  currentAddress: '',
  subjectProperty: null,
  subjectHistory: [],
  candidates: [],
  rankedComps: [],
  selectedComps: new Set(),
  preset: 'balanced',
  matchCount: 10,
  searchRadius: 1000, // meters
  categoryFilter: 'AUTO',
  disputeMode: true,
  sortColumn: 'score',
  sortDirection: 'desc',
  map: null,
  mapMarkers: [],
  mapRadiusCircle: null,
  charts: {
    pctChange: null,
    history: null,
    scatter: null
  }
};

// Weight configurations for Presets
const PRESET_WEIGHTS = {
  balanced: { sqft: 0.35, year: 0.20, stories: 0.15, beds_baths: 0.10, condition: 0.10, distance: 0.10 },
  era: { sqft: 0.25, year: 0.40, stories: 0.15, beds_baths: 0.05, condition: 0.05, distance: 0.10 },
  proximity: { sqft: 0.25, year: 0.15, stories: 0.10, beds_baths: 0.05, condition: 0.05, distance: 0.40 },
  layout: { sqft: 0.45, year: 0.10, stories: 0.20, beds_baths: 0.15, condition: 0.05, distance: 0.05 }
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
});

// Helper: Query Philadelphia Carto SQL API
async function queryCarto(sql) {
  const url = `${CARTO_SQL_URL}?q=${encodeURIComponent(sql)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Carto API Error: ${response.statusText}`);
  }
  const json = await response.json();
  return json.rows || [];
}

// Clean and normalize address string for Carto SQL querying
function cleanAddressInput(addr) {
  if (!addr) return '';
  let clean = addr.trim().toUpperCase();
  // Remove punctuation like periods, commas, hashes
  clean = clean.replace(/[.,#]/g, ' ');
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ');

  // Standard Philly Street Types & Directions
  const wordMap = [
    [/\bSTREET\b/g, 'ST'],
    [/\bAVENUE\b/g, 'AVE'],
    [/\bROAD\b/g, 'RD'],
    [/\bBOULEVARD\b/g, 'BLVD'],
    [/\bDRIVE\b/g, 'DR'],
    [/\bLANE\b/g, 'LN'],
    [/\bCOURT\b/g, 'CT'],
    [/\bPLACE\b/g, 'PL'],
    [/\bTERRACE\b/g, 'TER'],
    [/\bWAY\b/g, 'WAY'],
    [/\bNORTH\b/g, 'N'],
    [/\bSOUTH\b/g, 'S'],
    [/\bEAST\b/g, 'E'],
    [/\bWEST\b/g, 'W']
  ];
  for (const [pattern, repl] of wordMap) {
    clean = clean.replace(pattern, repl);
  }
  return clean.trim();
}

// Format Currency
function formatMoney(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return '$' + Math.round(num).toLocaleString('en-US');
}

// Format Percent
function formatPercent(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  const prefix = num > 0 ? '+' : '';
  return `${prefix}${num.toFixed(2)}%`;
}

// Initialize Leaflet Map
function initMap() {
  state.map = L.map('comps-map', {
    zoomControl: true,
    attributionControl: true
  }).setView([39.9849, -75.1237], 16);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);
}

// Get matched attribute tags between subject and candidate
function getMatchedAttributes(subject, candidate) {
  const matches = [];

  const subSqft = Number(subject.total_livable_area) || 0;
  const candSqft = Number(candidate.total_livable_area) || 0;
  if (subSqft > 0 && candSqft > 0) {
    const diffPct = ((candSqft - subSqft) / subSqft) * 100;
    if (Math.abs(diffPct) <= 3) {
      matches.push({ text: `Exact SqFt (${candSqft.toLocaleString()} vs ${subSqft.toLocaleString()})`, highlight: true });
    } else if (Math.abs(diffPct) <= 15) {
      matches.push({ text: `Similar SqFt (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%)`, highlight: true });
    } else {
      matches.push({ text: `${candSqft.toLocaleString()} sqft (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(0)}%)`, highlight: false });
    }
  }

  const subYr = parseInt(subject.year_built, 10) || 0;
  const candYr = parseInt(candidate.year_built, 10) || 0;
  if (subYr > 0 && candYr > 0) {
    const yrDiff = Math.abs(candYr - subYr);
    if (yrDiff === 0) {
      matches.push({ text: `Same Year (${candYr})`, highlight: true });
    } else if (yrDiff <= 5) {
      matches.push({ text: `Same Era (${candYr})`, highlight: true });
    } else if (subYr >= 2010 && candYr >= 2010) {
      matches.push({ text: `Modern (${candYr})`, highlight: true });
    } else if (subYr < 1940 && candYr < 1940) {
      matches.push({ text: `Historic (${candYr})`, highlight: false });
    } else {
      matches.push({ text: `Built ${candYr}`, highlight: false });
    }
  }

  const subStories = subject.number_stories;
  const candStories = candidate.number_stories;
  if (candStories) {
    matches.push({ 
      text: `${candStories} Stories`, 
      highlight: Boolean(subStories && String(subStories) === String(candStories)) 
    });
  }

  const subBeds = subject.number_of_bedrooms;
  const candBeds = candidate.number_of_bedrooms;
  const subBaths = subject.number_of_bathrooms;
  const candBaths = candidate.number_of_bathrooms;
  if (candBeds !== null && subBeds !== null) {
    if (String(candBeds) === String(subBeds) && String(candBaths) === String(subBaths)) {
      matches.push({ text: `Exact Layout (${candBeds}bd/${candBaths}ba)`, highlight: true });
    } else if (String(candBeds) === String(subBeds)) {
      matches.push({ text: `Same Beds (${candBeds}bd)`, highlight: false });
    }
  }

  const distM = Number(candidate.dist_meters) || 0;
  if (distM <= 60) {
    matches.push({ text: `Same Block (${Math.round(distM)}m)`, highlight: true });
  } else if (distM <= 250) {
    matches.push({ text: `Immediate Area (${Math.round(distM)}m)`, highlight: false });
  } else {
    matches.push({ text: `${Math.round(distM)}m away`, highlight: false });
  }

  return matches;
}

// Calculate Similarity and Dispute Scores
function calculateSimilarity(candidate) {
  const s = state.subjectProperty;
  const weights = PRESET_WEIGHTS[state.preset] || PRESET_WEIGHTS.balanced;

  // 1. Livable SqFt Relative Difference
  const sSqft = Number(s.total_livable_area) || 1200;
  const cSqft = Number(candidate.total_livable_area) || sSqft;
  const diffSqft = Math.abs(cSqft - sSqft) / Math.max(sSqft, 500);
  const scoreSqft = Math.max(0, 1.0 - diffSqft);

  // 2. Year Built / Era
  const sYr = parseInt(s.year_built, 10) || 1950;
  const cYr = parseInt(candidate.year_built, 10) || sYr;
  const diffYr = Math.abs(cYr - sYr);
  const scoreYr = Math.max(0, 1.0 - (diffYr / 40.0));

  // 3. Stories
  const sStories = Number(s.number_stories) || 2;
  const cStories = Number(candidate.number_stories) || sStories;
  const diffStories = Math.abs(cStories - sStories);
  const scoreStories = Math.max(0, 1.0 - (diffStories / 2.0));

  // 4. Beds & Baths
  const sBeds = Number(s.number_of_bedrooms) || 3;
  const cBeds = Number(candidate.number_of_bedrooms) || sBeds;
  const sBaths = Number(s.number_of_bathrooms) || 1;
  const cBaths = Number(candidate.number_of_bathrooms) || sBaths;
  const diffBedsBaths = (Math.abs(cBeds - sBeds) + Math.abs(cBaths - sBaths)) / 4.0;
  const scoreBedsBaths = Math.max(0, 1.0 - diffBedsBaths);

  // 5. Condition
  const sCond = parseInt(s.exterior_condition, 10) || 3;
  const cCond = parseInt(candidate.exterior_condition, 10) || sCond;
  const diffCond = Math.abs(cCond - sCond) / 4.0;
  const scoreCond = Math.max(0, 1.0 - diffCond);

  // 6. Geographic Distance
  const dist = Number(candidate.dist_meters) || 0;
  const scoreDist = Math.max(0, 1.0 - (dist / (state.searchRadius * 1.1)));

  const baseComposite = (
    weights.sqft * scoreSqft +
    weights.year * scoreYr +
    weights.stories * scoreStories +
    weights.beds_baths * scoreBedsBaths +
    weights.condition * scoreCond +
    weights.distance * scoreDist
  );

  const baseSimPct = Number((Math.max(0, Math.min(1.0, baseComposite)) * 100).toFixed(1));

  // 7. Dispute Scoring Preference (Strictly Lower $/SqFt Assessed Value)
  let disputeBonus = 0;
  const disputeReasons = [];

  const candVal27 = Number(candidate.val_2027) || 0;
  const candValSqft = (candVal27 > 0 && cSqft > 0) ? (candVal27 / cSqft) : null;
  const subValSqft = s.val_per_sqft_2027 || 0;

  if (state.disputeMode && candValSqft && subValSqft > 0) {
    const diffSqftVal = subValSqft - candValSqft;
    const diffPct = (diffSqftVal / subValSqft) * 100;

    if (diffSqftVal > 0) {
      // Direct appeal evidence: Property assessed at lower $/sqft than subject
      const sqftValBonus = Math.min(0.40, (diffSqftVal / subValSqft) * 0.50);
      disputeBonus += sqftValBonus;
      disputeReasons.push(`Lower $/sqft ($${candValSqft.toFixed(1)} vs $${subValSqft.toFixed(1)}, ${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}% lower)`);

      if (cSqft >= sSqft) {
        disputeBonus += 0.08;
        disputeReasons.push(`Equal/larger size (${cSqft.toLocaleString()} sqft)`);
      }
    } else {
      // Penalty if candidate has higher $/sqft
      const penalty = Math.min(0.35, (Math.abs(diffSqftVal) / subValSqft) * 0.40);
      disputeBonus -= penalty;
    }
  }

  const disputeScore = Number((Math.max(0, Math.min(1.0, baseComposite + disputeBonus)) * 100).toFixed(1));
  const disputeReasonStr = disputeReasons.length ? disputeReasons.join(' • ') : 'Standard match';

  return {
    baseSimilarity: baseSimPct,
    disputeScore: disputeScore,
    disputeReason: disputeReasonStr
  };
}

// Initialize UI Event Listeners
function initEventListeners() {
  const searchInput = document.getElementById('address-input');
  const searchBtn = document.getElementById('btn-search');
  const clearBtn = document.getElementById('btn-clear-search');
  const autocompleteBox = document.getElementById('autocomplete-results');

  // Search Button
  searchBtn.addEventListener('click', () => {
    const val = searchInput.value.trim();
    if (val) {
      autocompleteBox.classList.add('hidden');
      analyzeAddress(val);
    }
  });

  // Enter key triggers search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = searchInput.value.trim();
      if (val) {
        autocompleteBox.classList.add('hidden');
        analyzeAddress(val);
      }
    }
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    autocompleteBox.classList.add('hidden');
  });

  // Debounced Autocomplete
  let debounceTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimeout);
    const query = e.target.value.trim();
    if (query.length < 3) {
      autocompleteBox.classList.add('hidden');
      return;
    }
    debounceTimeout = setTimeout(() => {
      fetchAddressSuggestions(query);
    }, 280);
  });

  // Close autocomplete on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-bar-wrapper')) {
      autocompleteBox.classList.add('hidden');
    }
  });

  // Preset Buttons (Balanced, Era, Proximity, Layout)
  document.querySelectorAll('#preset-buttons .btn-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#preset-buttons .btn-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.preset = btn.dataset.preset;
      recomputeAndRenderComps();
    });
  });

  // Dispute Mode Toggle
  const disputeToggle = document.getElementById('toggle-dispute');
  if (disputeToggle) {
    disputeToggle.addEventListener('change', (e) => {
      state.disputeMode = e.target.checked;
      recomputeAndRenderComps();
    });
  }

  // Sliders
  const matchesSlider = document.getElementById('slider-matches');
  const matchesLabel = document.getElementById('label-matches-val');
  matchesSlider.addEventListener('input', (e) => {
    state.matchCount = parseInt(e.target.value, 10);
    matchesLabel.textContent = state.matchCount;
    recomputeAndRenderComps();
  });

  const radiusSlider = document.getElementById('slider-radius');
  const radiusLabel = document.getElementById('label-radius-val');
  radiusSlider.addEventListener('input', (e) => {
    state.searchRadius = parseInt(e.target.value, 10);
    const miles = (state.searchRadius * 0.000621371).toFixed(2);
    radiusLabel.textContent = `${state.searchRadius.toLocaleString()}m (${miles} mi)`;
  });
  radiusSlider.addEventListener('change', () => {
    if (state.subjectProperty) {
      fetchCandidatesAndProcess();
    }
  });

  // Category Select
  const categorySelect = document.getElementById('select-category');
  categorySelect.addEventListener('change', (e) => {
    state.categoryFilter = e.target.value;
    if (state.subjectProperty) {
      fetchCandidatesAndProcess();
    }
  });

  // Select/Deselect All Comps
  document.getElementById('btn-toggle-all').addEventListener('click', () => {
    if (state.selectedComps.size === state.rankedComps.length) {
      state.selectedComps.clear();
    } else {
      state.rankedComps.forEach(c => state.selectedComps.add(c.parcel_number));
    }
    renderTable();
    updateAnomalyMetrics();
  });

  // Table Column Sort
  document.querySelectorAll('#comps-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = col;
        state.sortDirection = ['score', 'similarity', 'val26', 'val27', 'pct', 'sqftval'].includes(col) ? 'desc' : 'asc';
      }
      sortAndRenderTable();
    });
  });

  // Modal & Appeal Packet Actions
  const modal = document.getElementById('appeal-modal');
  document.getElementById('btn-open-appeal').addEventListener('click', () => {
    populateAppealDocument();
    modal.classList.remove('hidden');
  });

  document.getElementById('btn-close-modal').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  document.getElementById('btn-print-appeal').addEventListener('click', () => {
    window.print();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // CSV Export
  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);
}

// Fetch Address Autocomplete Suggestions from Carto
async function fetchAddressSuggestions(query) {
  const dropdown = document.getElementById('autocomplete-results');
  const clean = cleanAddressInput(query);
  if (!clean || clean.length < 2) {
    dropdown.classList.add('hidden');
    return;
  }

  const parts = clean.split(' ');
  let rangeCond = '';
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    const num = parts[0];
    const street = parts.slice(1).join(' ');
    rangeCond = `OR (UPPER(location) LIKE '${num}-%' AND UPPER(location) LIKE '%${street}%')`;
  }

  const sql = `
    SELECT location, zip_code, total_livable_area, category_code_description
    FROM opa_properties_public
    WHERE UPPER(location) = '${clean}'
       OR UPPER(location) LIKE '${clean}%'
       OR UPPER(location) LIKE '%${clean}%'
       ${rangeCond}
    ORDER BY 
       CASE 
         WHEN UPPER(location) = '${clean}' THEN 0 
         WHEN UPPER(location) LIKE '${clean}%' THEN 1
         ELSE 2 
       END
    LIMIT 6
  `;
  try {
    const rows = await queryCarto(sql);
    if (!rows.length) {
      dropdown.classList.add('hidden');
      return;
    }
    dropdown.innerHTML = rows.map(r => `
      <div class="autocomplete-item" data-address="${r.location}">
        <div class="autocomplete-loc">${r.location}</div>
        <div class="autocomplete-meta">${r.category_code_description || 'Residential'} • ${r.zip_code || ''} • ${r.total_livable_area || 0} sqft</div>
      </div>
    `).join('');
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const selected = item.dataset.address;
        document.getElementById('address-input').value = selected;
        dropdown.classList.add('hidden');
        analyzeAddress(selected);
      });
    });
  } catch (err) {
    console.error('Autocomplete error:', err);
  }
}

// Main Flow: Lookup Subject Address and Query Candidates
async function analyzeAddress(address) {
  const loading = document.getElementById('loading-state');
  const clean = cleanAddressInput(address);

  loading.classList.remove('hidden');
  document.getElementById('loading-text').textContent = `Looking up ${clean} in Philadelphia Property Assessment records...`;
  
  try {
    const parts = clean.split(' ');
    let rangeCond = '';
    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      const num = parts[0];
      const street = parts.slice(1).join(' ');
      rangeCond = `OR (UPPER(p.location) LIKE '${num}-%' AND UPPER(p.location) LIKE '%${street}%')`;
    }

    const subjectSql = `
      SELECT 
        p.*,
        ST_Y(p.the_geom) as lat,
        ST_X(p.the_geom) as lng
      FROM opa_properties_public p
      WHERE UPPER(p.location) = '${clean}'
         OR UPPER(p.location) LIKE '${clean}%'
         OR UPPER(p.location) LIKE '%${clean}%'
         ${rangeCond}
      ORDER BY 
         CASE 
           WHEN UPPER(p.location) = '${clean}' THEN 0 
           WHEN UPPER(p.location) LIKE '${clean}%' THEN 1
           ELSE 2 
         END
      LIMIT 1
    `;
    const subjectRows = await queryCarto(subjectSql);
    if (!subjectRows.length) {
      alert(`Property "${address}" not found in OPA records. Please verify the street address.`);
      loading.classList.add('hidden');
      return;
    }
    state.subjectProperty = subjectRows[0];
    state.currentAddress = state.subjectProperty.location;
    document.getElementById('address-input').value = state.currentAddress;

    const histSql = `
      SELECT *
      FROM assessments
      WHERE parcel_number = '${state.subjectProperty.parcel_number}'
      ORDER BY year DESC
    `;
    state.subjectHistory = await queryCarto(histSql);

    renderSubjectCard();
    
    // Switch from empty state to results view
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    const resultsCont = document.getElementById('results-container');
    if (resultsCont) resultsCont.classList.remove('hidden');
    if (state.map) setTimeout(() => state.map.invalidateSize(), 150);

    await fetchCandidatesAndProcess();

    document.getElementById('btn-open-appeal').disabled = false;
    document.getElementById('btn-export-csv').disabled = false;

  } catch (err) {
    console.error('Error analyzing property:', err);
    alert(`Failed to load property data: ${err.message}`);
  } finally {
    loading.classList.add('hidden');
  }
}

// Render Subject Property Hero Card
function renderSubjectCard() {
  const p = state.subjectProperty;
  const hist = state.subjectHistory;

  let val27 = null;
  let val26 = null;
  let rec27 = null;

  hist.forEach(r => {
    if (r.year === '2027') {
      val27 = Number(r.market_value);
      rec27 = r;
    } else if (r.year === '2026') {
      val26 = Number(r.market_value);
    }
  });

  if (val27 === null) val27 = Number(p.market_value) || 0;
  p.val_2027 = val27;
  p.val_2026 = val26;

  const sqft = Number(p.total_livable_area) || 1;
  const pctChange = val26 ? ((val27 - val26) / val26) * 100 : 0;
  const dollarChange = val26 ? (val27 - val26) : 0;

  p.pct_change = pctChange;
  p.dollar_change = dollarChange;
  p.val_per_sqft_2027 = sqft > 0 ? (val27 / sqft) : 0;
  p.val_per_sqft_2026 = (val26 && sqft > 0) ? (val26 / sqft) : 0;

  document.getElementById('subject-address').textContent = p.location;
  document.getElementById('subject-subtitle').textContent = `Parcel #${p.parcel_number} • Ward ${p.geographic_ward || 'N/A'} • Census Tract ${p.census_tract || 'N/A'} • Zip ${p.zip_code || 'N/A'}`;
  document.getElementById('link-atlas').href = `https://atlas.phila.gov/#/${p.parcel_number}/property`;

  document.getElementById('sub-val-2026').textContent = val26 ? formatMoney(val26) : 'N/A';
  document.getElementById('sub-val-2026-sqft').textContent = val26 ? `$${p.val_per_sqft_2026.toFixed(2)} / sqft` : '';

  document.getElementById('sub-val-2027').textContent = formatMoney(val27);
  document.getElementById('sub-val-2027-sqft').textContent = `$${p.val_per_sqft_2027.toFixed(2)} / sqft`;

  const pctElem = document.getElementById('sub-pct-change');
  pctElem.textContent = formatPercent(pctChange);
  pctElem.className = `metric-value badge-change ${pctChange <= 0 ? 'decrease' : ''}`;

  document.getElementById('sub-dollar-change').textContent = `${dollarChange >= 0 ? '+' : ''}${formatMoney(dollarChange)} change`;

  document.getElementById('sub-profile-sqft').textContent = `${sqft.toLocaleString()} sqft`;
  document.getElementById('sub-profile-details').textContent = `${p.number_of_bedrooms || 0} Beds • ${p.number_of_bathrooms || 0} Baths • ${p.number_stories || 2} Stories • Built ${p.year_built || 'N/A'}`;

  if (rec27) {
    document.getElementById('val-exempt-bldg').textContent = formatMoney(Number(rec27.exempt_building || 0));
    document.getElementById('val-tax-bldg').textContent = formatMoney(Number(rec27.taxable_building || 0));
    document.getElementById('val-tax-land').textContent = formatMoney(Number(rec27.taxable_land || 0));
  } else {
    document.getElementById('val-exempt-bldg').textContent = formatMoney(Number(p.exempt_building || 0));
    document.getElementById('val-tax-bldg').textContent = formatMoney(Number(p.taxable_building || 0));
    document.getElementById('val-tax-land').textContent = formatMoney(Number(p.taxable_land || 0));
  }
  document.getElementById('val-zoning').textContent = p.zoning || 'N/A';
  const condNames = { '1': 'New/Rehabbed', '2': 'Good', '3': 'Average', '4': 'Fair', '5': 'Poor', '6': 'Vacant' };
  document.getElementById('val-condition').textContent = `${condNames[p.exterior_condition] || 'Standard'} (${p.exterior_condition || '3'})`;
}

// Fetch Candidates from Spatial Radius
async function fetchCandidatesAndProcess() {
  const p = state.subjectProperty;
  if (!p || !p.lat || !p.lng) return;

  const sqft = Number(p.total_livable_area) || 1500;
  const sqftMin = Math.max(350, Math.round(sqft * 0.40));
  const sqftMax = Math.round(sqft * 1.85);
  const radius = state.searchRadius;

  let catFilterSql = '';
  if (state.categoryFilter === 'AUTO') {
    const cat = p.category_code_description || 'SINGLE FAMILY';
    catFilterSql = `AND p.category_code_description = '${cat}'`;
  } else if (state.categoryFilter === 'SINGLE FAMILY' || state.categoryFilter === 'MULTI FAMILY') {
    catFilterSql = `AND p.category_code_description = '${state.categoryFilter}'`;
  }

  const query = `
    SELECT 
      p.location, 
      p.parcel_number, 
      p.total_livable_area, 
      p.total_area,
      p.number_stories, 
      p.number_of_bedrooms, 
      p.number_of_bathrooms, 
      p.year_built,
      p.building_code_description,
      p.exterior_condition,
      p.zoning,
      p.category_code_description,
      p.sale_date,
      p.sale_price,
      ST_Y(p.the_geom) as lat, 
      ST_X(p.the_geom) as lng,
      ROUND(ST_Distance(p.the_geom::geography, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography)::numeric, 1) as dist_meters,
      a27.market_value as val_2027,
      a27.taxable_building as taxable_building_2027,
      a27.exempt_building as exempt_building_2027,
      a27.taxable_land as taxable_land_2027,
      a26.market_value as val_2026,
      ROUND(((a27.market_value - a26.market_value)::numeric / NULLIF(a26.market_value, 0)::numeric) * 100, 2) as pct_change
    FROM opa_properties_public p
    LEFT JOIN assessments a27 ON a27.parcel_number = p.parcel_number AND a27.year = '2027'
    LEFT JOIN assessments a26 ON a26.parcel_number = p.parcel_number AND a26.year = '2026'
    WHERE p.parcel_number != '${p.parcel_number}'
      AND p.total_livable_area BETWEEN ${sqftMin} AND ${sqftMax}
      AND ST_DWithin(p.the_geom::geography, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, ${radius})
      ${catFilterSql}
    ORDER BY dist_meters ASC
    LIMIT 150
  `;

  state.candidates = await queryCarto(query);
  recomputeAndRenderComps();
}

// Recompute Similarity Scores, Rank, and Update Visuals
function recomputeAndRenderComps() {
  if (!state.candidates.length) {
    state.rankedComps = [];
    state.selectedComps.clear();
    renderTable();
    updateAnomalyMetrics();
    updateMap();
    updateCharts();
    return;
  }

  // Calculate scores, matched attributes, and $/sqft for all candidates
  state.candidates.forEach(cand => {
    const scores = calculateSimilarity(cand);
    cand.similarity_score = scores.baseSimilarity;
    cand.dispute_score = scores.disputeScore;
    cand.dispute_reason = scores.disputeReason;
    cand.matched_attributes = getMatchedAttributes(state.subjectProperty, cand);

    const sq = Number(cand.total_livable_area) || 0;
    cand.val_per_sqft_2027 = (cand.val_2027 && sq > 0) ? (Number(cand.val_2027) / sq) : null;
  });

  // Sort candidates
  const sortKey = state.disputeMode ? 'dispute_score' : 'similarity_score';
  state.candidates.sort((a, b) => b[sortKey] - a[sortKey]);

  // Take top N
  state.rankedComps = state.candidates.slice(0, state.matchCount);

  // Default: select all top N
  state.selectedComps = new Set(state.rankedComps.map(c => c.parcel_number));

  sortAndRenderTable();
  updateAnomalyMetrics();
  updateMap();
  updateCharts();
}

// Update Anomaly Metrics & Percentile Gauge
function updateAnomalyMetrics() {
  const s = state.subjectProperty;
  const activeComps = state.rankedComps.filter(c => state.selectedComps.has(c.parcel_number));

  document.getElementById('text-matched-count').textContent = activeComps.length;

  if (!activeComps.length) return;

  const pctChanges = activeComps.map(c => Number(c.pct_change)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const sqftValues = activeComps.map(c => Number(c.val_per_sqft_2027)).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

  const medianPct = pctChanges.length ? pctChanges[Math.floor(pctChanges.length / 2)] : 0;
  const avgPct = pctChanges.length ? (pctChanges.reduce((a, b) => a + b, 0) / pctChanges.length) : 0;

  const medianSqft = sqftValues.length ? sqftValues[Math.floor(sqftValues.length / 2)] : 0;
  const avgSqft = sqftValues.length ? (sqftValues.reduce((a, b) => a + b, 0) / sqftValues.length) : 0;

  document.getElementById('stat-cohort-median').textContent = formatPercent(medianPct);
  document.getElementById('stat-cohort-avg').textContent = `Average: ${formatPercent(avgPct)}`;

  document.getElementById('stat-cohort-sqft').textContent = `$${medianSqft.toFixed(2)}`;
  document.getElementById('stat-cohort-sqft-avg').textContent = `Average: $${avgSqft.toFixed(2)} / sqft`;

  const sVal26 = s.val_2026 || s.val_2027;
  const sVal27 = s.val_2027;
  const sPct = s.pct_change || 0;
  const sSqft = Number(s.total_livable_area) || 1;

  // In dispute mode, target assessment is based on the cohort's median $/sqft
  const projectedFairVal = state.disputeMode 
    ? (medianSqft * sSqft)
    : (sVal26 * (1 + (medianPct / 100.0)));
  const overAssessment = Math.max(0, sVal27 - projectedFairVal);

  document.getElementById('stat-target-val').textContent = formatMoney(projectedFairVal);
  document.getElementById('stat-overassessment').textContent = overAssessment > 0 ? `~${formatMoney(overAssessment)}` : '$0 (Fair)';

  const lowerCount = pctChanges.filter(p => p < sPct).length;
  const percentile = pctChanges.length ? Math.round((lowerCount / pctChanges.length) * 100) : 100;

  const badge = document.getElementById('anomaly-badge');
  const marker = document.getElementById('percentile-marker');
  const markerBubble = document.getElementById('marker-bubble');

  marker.style.left = `${Math.min(98, Math.max(2, percentile))}%`;
  markerBubble.textContent = `You: ${formatPercent(sPct)} (${percentile}th %ile)`;

  if (percentile >= 90) {
    badge.className = 'anomaly-pill pill-danger';
    badge.textContent = `⚠️ Severe Outlier (${percentile}th Percentile)`;
  } else if (percentile >= 70) {
    badge.className = 'anomaly-pill pill-warning';
    badge.textContent = `⚠️ High Assessment (${percentile}th Percentile)`;
  } else {
    badge.className = 'anomaly-pill pill-success';
    badge.textContent = `✓ Uniform Assessment (${percentile}th Percentile)`;
  }
}

// Sort & Render Table
function sortAndRenderTable() {
  const col = state.sortColumn;
  const dir = state.sortDirection === 'asc' ? 1 : -1;

  state.rankedComps.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    if (col === 'score') {
      valA = state.disputeMode ? a.dispute_score : a.similarity_score;
      valB = state.disputeMode ? b.dispute_score : b.similarity_score;
    }
    else if (col === 'dist') { valA = Number(a.dist_meters); valB = Number(b.dist_meters); }
    else if (col === 'sqft') { valA = Number(a.total_livable_area); valB = Number(b.total_livable_area); }
    else if (col === 'stories') { valA = Number(a.number_stories); valB = Number(b.number_stories); }
    else if (col === 'beds') { valA = Number(a.number_of_bedrooms); valB = Number(b.number_of_bedrooms); }
    else if (col === 'year') { valA = Number(a.year_built); valB = Number(b.year_built); }
    else if (col === 'val26') { valA = Number(a.val_2026 || 0); valB = Number(b.val_2026 || 0); }
    else if (col === 'val27') { valA = Number(a.val_2027 || 0); valB = Number(b.val_2027 || 0); }
    else if (col === 'pct') { valA = Number(a.pct_change || 0); valB = Number(b.pct_change || 0); }
    else if (col === 'sqftval') { valA = Number(a.val_per_sqft_2027 || 0); valB = Number(b.val_per_sqft_2027 || 0); }

    if (valA < valB) return -1 * dir;
    if (valA > valB) return 1 * dir;
    return 0;
  });

  renderTable();
}

// Render Table Rows
function renderTable() {
  const tbody = document.getElementById('comps-tbody');
  if (!state.rankedComps.length) {
    tbody.innerHTML = `<tr><td colspan="15" class="td-center">No comparable properties found within selected radius. Try expanding search radius.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.rankedComps.map((c, idx) => {
    const isIncluded = state.selectedComps.has(c.parcel_number);
    const scoreVal = state.disputeMode ? c.dispute_score : c.similarity_score;
    const scoreClass = scoreVal >= 85 ? 'score-high' : (scoreVal >= 70 ? 'score-med' : 'score-low');
    
    let pctPillClass = 'flat-down';
    if (c.pct_change > 5) pctPillClass = 'up-high';
    else if (c.pct_change > 0) pctPillClass = 'up-mod';

    const chipsHtml = (c.matched_attributes || []).map(attr => 
      `<span class="attr-chip ${attr.highlight ? 'highlight' : ''}">${attr.text}</span>`
    ).join('');

    const disputeBadge = (state.disputeMode && c.dispute_reason && c.dispute_reason !== 'Standard match') 
      ? `<div class="dispute-reason-badge">✓ ${c.dispute_reason}</div>`
      : '';

    return `
      <tr class="${isIncluded ? '' : 'excluded'}" data-parcel="${c.parcel_number}">
        <td class="td-center" onclick="event.stopPropagation()">
          <input type="checkbox" class="comp-checkbox" data-parcel="${c.parcel_number}" ${isIncluded ? 'checked' : ''}>
        </td>
        <td class="td-center font-bold">${idx + 1}</td>
        <td><span class="score-badge ${scoreClass}">${scoreVal}%</span></td>
        <td><strong>${c.location}</strong></td>
        <td>
          <div class="attr-chips-list">${chipsHtml}</div>
          ${disputeBadge}
        </td>
        <td>${Math.round(c.dist_meters)}m</td>
        <td>${c.total_livable_area || 'N/A'}</td>
        <td>${c.number_stories || 'N/A'}</td>
        <td>${c.number_of_bedrooms || 0} / ${c.number_of_bathrooms || 0}</td>
        <td>${c.year_built || 'N/A'}</td>
        <td>${formatMoney(c.val_2026)}</td>
        <td>${formatMoney(c.val_2027)}</td>
        <td><span class="val-pct-pill ${pctPillClass}">${formatPercent(c.pct_change)}</span></td>
        <td>${c.val_per_sqft_2027 ? `$${c.val_per_sqft_2027.toFixed(1)}` : 'N/A'}</td>
        <td class="td-center" onclick="event.stopPropagation()">
          <a href="https://atlas.phila.gov/#/${c.parcel_number}/property" target="_blank" rel="noopener" class="btn-icon" title="View on Phila Atlas">↗</a>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const parcel = tr.dataset.parcel;
      const comp = state.rankedComps.find(c => c.parcel_number === parcel);
      if (comp && comp.lat && comp.lng) {
        state.map.flyTo([comp.lat, comp.lng], 18, { duration: 0.8 });
        const m = state.mapMarkers.find(marker => marker.parcel_number === parcel);
        if (m) m.openPopup();
      }
    });
  });

  tbody.querySelectorAll('.comp-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const parcel = cb.dataset.parcel;
      if (e.target.checked) {
        state.selectedComps.add(parcel);
      } else {
        state.selectedComps.delete(parcel);
      }
      renderTable();
      updateAnomalyMetrics();
      updateCharts();
    });
  });
}

// Update Leaflet Map Markers & Radius
function updateMap() {
  if (!state.map || !state.subjectProperty) return;
  const s = state.subjectProperty;

  state.mapMarkers.forEach(m => state.map.removeLayer(m));
  state.mapMarkers = [];
  if (state.mapRadiusCircle) {
    state.map.removeLayer(state.mapRadiusCircle);
  }

  state.mapRadiusCircle = L.circle([s.lat, s.lng], {
    radius: state.searchRadius,
    color: '#3b82f6',
    weight: 1.5,
    dashArray: '4, 6',
    fillColor: '#3b82f6',
    fillOpacity: 0.04
  }).addTo(state.map);

  const subjectIcon = L.divIcon({
    className: 'custom-map-icon',
    html: `<div style="background:#7c3aed; color:white; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow:0 3px 8px rgba(0,0,0,0.3); font-weight:800; font-size:14px;">★</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const subjectMarker = L.marker([s.lat, s.lng], { icon: subjectIcon, zIndexOffset: 1000 }).addTo(state.map);
  subjectMarker.bindPopup(`
    <div style="font-family:sans-serif; min-width:200px;">
      <div style="font-size:11px; font-weight:800; color:#7c3aed; text-transform:uppercase;">Subject Property</div>
      <div style="font-size:14px; font-weight:700; margin:2px 0;">${s.location}</div>
      <div style="font-size:12px; color:#475569;">${s.total_livable_area} sqft • Built ${s.year_built}</div>
      <div style="margin-top:6px; font-size:13px;"><strong>2027 Value:</strong> ${formatMoney(s.val_2027)} (<span style="color:#dc2626; font-weight:700;">${formatPercent(s.pct_change)}</span>)</div>
    </div>
  `);
  state.mapMarkers.push(subjectMarker);

  const bounds = L.latLngBounds([[s.lat, s.lng]]);

  state.rankedComps.forEach((c, idx) => {
    if (!c.lat || !c.lng) return;
    bounds.extend([c.lat, c.lng]);

    let color = '#10b981';
    if (c.pct_change > 5) color = '#ef4444';
    else if (c.pct_change > 0) color = '#f59e0b';

    const compIcon = L.divIcon({
      className: 'custom-comp-icon',
      html: `<div style="background:${color}; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.25); font-weight:700; font-size:11px;">${idx + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const m = L.marker([c.lat, c.lng], { icon: compIcon }).addTo(state.map);
    m.parcel_number = c.parcel_number;

    const scoreDisplay = state.disputeMode ? `${c.dispute_score}% Dispute Score` : `${c.similarity_score}% Match`;
    const matchedStr = (c.matched_attributes || []).map(a => a.text).join(' • ');

    m.bindPopup(`
      <div style="font-family:sans-serif; min-width:220px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b; font-weight:700;">
          <span>#${idx + 1} • ${scoreDisplay}</span>
          <span>${Math.round(c.dist_meters)}m away</span>
        </div>
        <div style="font-size:14px; font-weight:700; margin:2px 0;">${c.location}</div>
        <div style="font-size:12px; color:#475569;">${c.total_livable_area} sqft • ${c.number_stories} sty • Built ${c.year_built}</div>
        <div style="font-size:11px; color:#2563eb; margin-top:2px;">${matchedStr}</div>
        <div style="margin-top:6px; font-size:12px; border-top:1px solid #e2e8f0; padding-top:4px;">
          <div><strong>2026:</strong> ${formatMoney(c.val_2026)} &rarr; <strong>2027:</strong> ${formatMoney(c.val_2027)}</div>
          <div><strong>Assessment Change:</strong> <span style="font-weight:700; color:${color};">${formatPercent(c.pct_change)}</span> ($${c.val_per_sqft_2027 ? c.val_per_sqft_2027.toFixed(1) : 'N/A'}/sqft)</div>
        </div>
      </div>
    `);
    state.mapMarkers.push(m);
  });

  state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
}

// Update Chart.js Visualizations
function updateCharts() {
  const s = state.subjectProperty;
  const activeComps = state.rankedComps.filter(c => state.selectedComps.has(c.parcel_number));

  // Chart 1: % Assessment Change Bar Chart
  const ctxPct = document.getElementById('chart-pct-change');
  if (state.charts.pctChange) state.charts.pctChange.destroy();

  const labels = ['Subject', ...activeComps.map((c, i) => `#${i + 1} ${c.location.split(' ')[0]}`)];
  const dataPct = [s.pct_change, ...activeComps.map(c => Number(c.pct_change) || 0)];
  const bgColors = ['#7c3aed', ...activeComps.map(c => (c.pct_change > 5 ? '#ef4444' : (c.pct_change > 0 ? '#f59e0b' : '#10b981')))];

  state.charts.pctChange = new Chart(ctxPct, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '% Assessment Increase',
        data: dataPct,
        backgroundColor: bgColors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Increase: ${ctx.parsed.y.toFixed(2)}%`
          }
        }
      },
      scales: {
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { callback: v => `${v}%` }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } }
        }
      }
    }
  });

  // Chart 2: Multi-Year Historical Assessment Trajectory
  const ctxHist = document.getElementById('chart-history');
  if (state.charts.history) state.charts.history.destroy();

  const histSorted = [...state.subjectHistory].sort((a, b) => Number(a.year) - Number(b.year)).filter(h => Number(h.year) >= 2018);
  const years = histSorted.map(h => h.year);
  const histValues = histSorted.map(h => Number(h.market_value));

  state.charts.history = new Chart(ctxHist, {
    type: 'line',
    data: {
      labels: years,
      datasets: [{
        label: 'Subject Property Value ($)',
        data: histValues,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.08)',
        fill: true,
        tension: 0.2,
        pointRadius: 4,
        pointBackgroundColor: '#7c3aed'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Assessed: ${formatMoney(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { callback: v => `$${(v / 1000).toFixed(0)}k` }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // Chart 3: Livable Area vs 2027 Value Scatter Plot
  const ctxScatter = document.getElementById('chart-scatter');
  if (state.charts.scatter) state.charts.scatter.destroy();

  const scatterData = activeComps.map(c => ({
    x: Number(c.total_livable_area),
    y: Number(c.val_2027),
    label: c.location
  })).filter(pt => pt.x > 0 && pt.y > 0);

  state.charts.scatter = new Chart(ctxScatter, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Comparable Homes',
          data: scatterData,
          backgroundColor: '#3b82f6',
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'Subject Property',
          data: [{ x: Number(s.total_livable_area), y: Number(s.val_2027), label: s.location }],
          backgroundColor: '#7c3aed',
          borderColor: '#ffffff',
          borderWidth: 2,
          pointRadius: 10,
          pointHoverRadius: 12
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pt = ctx.raw;
              return `${pt.label}: ${pt.x.toLocaleString()} sqft, ${formatMoney(pt.y)} ($${(pt.y / pt.x).toFixed(1)}/sqft)`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Total Livable Area (Square Feet)', font: { weight: 'bold' } },
          grid: { color: '#f1f5f9' }
        },
        y: {
          title: { display: true, text: '2027 Assessed Market Value ($)', font: { weight: 'bold' } },
          grid: { color: '#f1f5f9' },
          ticks: { callback: v => `$${(v / 1000).toFixed(0)}k` }
        }
      }
    }
  });
}

// Populate Appeal Document Modal Content
function populateAppealDocument() {
  const s = state.subjectProperty;
  const activeComps = state.rankedComps.filter(c => state.selectedComps.has(c.parcel_number));

  document.getElementById('appeal-doc-date').textContent = `Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

  document.getElementById('doc-sub-address').textContent = s.location;
  document.getElementById('doc-sub-parcel').textContent = s.parcel_number;
  document.getElementById('doc-sub-sqft').textContent = `${Number(s.total_livable_area).toLocaleString()} sq. ft.`;
  document.getElementById('doc-sub-layout').textContent = `${s.number_of_bedrooms || 0} Beds / ${s.number_of_bathrooms || 0} Baths`;
  document.getElementById('doc-sub-year').textContent = s.year_built || 'N/A';
  document.getElementById('doc-sub-zoning').textContent = `${s.zoning || 'RSA5'} / Ward ${s.geographic_ward || 'N/A'}`;
  document.getElementById('doc-sub-v26').textContent = formatMoney(s.val_2026);
  document.getElementById('doc-sub-v27').textContent = `${formatMoney(s.val_2027)} (${formatPercent(s.pct_change)})`;

  const pctChanges = activeComps.map(c => Number(c.pct_change)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const sqftValues = activeComps.map(c => Number(c.val_per_sqft_2027)).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
  const medianPct = pctChanges.length ? pctChanges[Math.floor(pctChanges.length / 2)] : 0;
  const avgPct = pctChanges.length ? (pctChanges.reduce((a, b) => a + b, 0) / pctChanges.length) : 0;
  const medianSqft = sqftValues.length ? sqftValues[Math.floor(sqftValues.length / 2)] : 0;
  const sSqft = Number(s.total_livable_area) || 1;

  const projFair = state.disputeMode ? (medianSqft * sSqft) : ((s.val_2026 || s.val_2027) * (1 + (medianPct / 100.0)));
  const disparity = Math.max(0, s.val_2027 - projFair);

  document.getElementById('doc-appeal-increase').textContent = formatPercent(s.pct_change);
  document.getElementById('doc-appeal-count').textContent = activeComps.length;
  document.getElementById('doc-appeal-median-increase').textContent = formatPercent(medianPct);
  document.getElementById('doc-appeal-mean-increase').textContent = formatPercent(avgPct);

  document.getElementById('doc-disp-current').textContent = formatMoney(s.val_2027);
  document.getElementById('doc-disp-equitable').textContent = formatMoney(projFair);
  document.getElementById('doc-disp-over').textContent = `+${formatMoney(disparity)}`;

  const tbody = document.getElementById('doc-comps-tbody');
  tbody.innerHTML = activeComps.map((c, i) => {
    const matchedStr = (c.matched_attributes || []).map(a => a.text).join('; ');
    const reasonStr = c.dispute_reason || 'Similar characteristics';
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${c.location}</strong></td>
        <td>${matchedStr}</td>
        <td style="color:#059669; font-weight:600;">${reasonStr}</td>
        <td>${Math.round(c.dist_meters)}m</td>
        <td>${c.total_livable_area || 0}</td>
        <td>${c.year_built || 'N/A'}</td>
        <td>${formatMoney(c.val_2026)}</td>
        <td>${formatMoney(c.val_2027)}</td>
        <td>${formatPercent(c.pct_change)}</td>
        <td>$${c.val_per_sqft_2027 ? c.val_per_sqft_2027.toFixed(1) : 'N/A'}</td>
      </tr>
    `;
  }).join('');
}

// Export CSV
function exportToCSV() {
  const s = state.subjectProperty;
  const activeComps = state.rankedComps.filter(c => state.selectedComps.has(c.parcel_number));

  const pctChanges = activeComps.map(c => Number(c.pct_change)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const sqftValues = activeComps.map(c => Number(c.val_per_sqft_2027)).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
  const medianPct = pctChanges.length ? pctChanges[Math.floor(pctChanges.length / 2)] : 0;
  const medianSqft = sqftValues.length ? sqftValues[Math.floor(sqftValues.length / 2)] : 0;
  const sSqft = Number(s.total_livable_area) || 1;

  const projFair = state.disputeMode ? (medianSqft * sSqft) : ((s.val_2026 || s.val_2027) * (1 + (medianPct / 100.0)));
  const disparity = Math.max(0, s.val_2027 - projFair);

  let csv = 'Philadelphia OPA Assessment Appeal Evidence Report\n';
  csv += `Subject Property,${s.location}\n`;
  csv += `Parcel Number,${s.parcel_number}\n`;
  csv += `Livable SqFt,${s.total_livable_area}\n`;
  csv += `Year Built,${s.year_built}\n`;
  csv += `2026 Value,${s.val_2026 || ''}\n`;
  csv += `2027 Value,${s.val_2027 || ''}\n`;
  csv += `Subject Assessed $/SqFt,$${s.val_per_sqft_2027.toFixed(2)}\n`;
  csv += `Comps Median Assessed $/SqFt,$${medianSqft.toFixed(2)}\n`;
  csv += `Subject Increase %,${s.pct_change.toFixed(2)}%\n`;
  csv += `Cohort Median Increase %,${medianPct.toFixed(2)}%\n`;
  csv += `Est. Over-Assessment Disparity,${disparity.toFixed(0)}\n`;
  csv += `Dispute Mode Active,${state.disputeMode}\n\n`;

  csv += 'Rank,Score %,Address,Parcel Number,Matched Characteristics,Appeal Evidence Rationale,Distance (m),Livable SqFt,Stories,Beds,Baths,Year Built,2026 Value,2027 Value,Change %,Value/SqFt,Atlas URL\n';

  activeComps.forEach((c, i) => {
    const scoreVal = state.disputeMode ? c.dispute_score : c.similarity_score;
    const matchedStr = (c.matched_attributes || []).map(a => a.text).join('; ');
    csv += [
      i + 1,
      `${scoreVal}%`,
      `"${c.location}"`,
      c.parcel_number,
      `"${matchedStr}"`,
      `"${c.dispute_reason || ''}"`,
      Math.round(c.dist_meters),
      c.total_livable_area,
      c.number_stories,
      c.number_of_bedrooms,
      c.number_of_bathrooms,
      c.year_built,
      c.val_2026,
      c.val_2027,
      `${c.pct_change}%`,
      c.val_per_sqft_2027 ? c.val_per_sqft_2027.toFixed(1) : '',
      `https://atlas.phila.gov/#/${c.parcel_number}/property`
    ].join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `OPA_Appeal_Comps_${s.location.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
