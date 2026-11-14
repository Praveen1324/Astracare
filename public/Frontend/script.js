// =========================================================
// 0. AUTHENTICATION & USER ROSTER (SQLITE BACKEND API)
// =========================================================
const AUTH_SESSION_KEY = 'astrumActiveSession';

function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function authenticateUser(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok || !data || !data.username) {
    return null;
  }
  const userObj = data.user || data;
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(userObj));
  return userObj;
}

function logoutUser() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  window.location.href = 'login.html';
}

function enforceRouteAccess(page) {
  const user = getCurrentUser();

  if (page === 'login') {
    if (user) window.location.href = 'index.html';
    return null;
  }

  if (!user) {
    window.location.href = 'login.html';
    return null;
  }

  if (page === 'admin' && user.role !== 'admin') {
    window.location.href = 'index.html';
    return null;
  }

  return user;
}

function injectNavAuthControls(user, page) {
  if (!user) return;
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  if (user.role === 'admin') {
    const adminLink = document.createElement('a');
    adminLink.href = 'admin.html';
    adminLink.className = 'nav-link admin-tab' + (page === 'admin' ? ' active' : '');
    adminLink.textContent = 'Crew Admin';
    navLinks.appendChild(adminLink);
  }

  const controls = document.createElement('div');
  controls.className = 'nav-user-controls';
  controls.innerHTML = `
    <span class="nav-user-badge">${user.username} (${user.role.toUpperCase()})</span>
    <button type="button" id="navLogoutBtn" class="nav-logout-btn">Logout</button>
  `;
  navLinks.appendChild(controls);

  document.getElementById('navLogoutBtn').addEventListener('click', logoutUser);
}

async function renderAdminRosterTable(currentUser) {
  const tbody = document.getElementById('crewRosterTableBody');
  const badge = document.getElementById('rosterCountBadge');
  if (!tbody) return;

  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    if (badge) badge.textContent = `${users.length} ACCOUNT(S)`;

    tbody.innerHTML = users.map(u => {
      const isProtected = u.username === 'admin' || u.username === currentUser.username;
      return `
        <tr>
          <td><strong>${u.fullName}</strong></td>
          <td style="font-family: var(--font-mono); color: var(--cyan-bright);">${u.username}</td>
          <td><span class="status-pill ${u.role === 'admin' ? 'alert' : 'normal'}">${u.role.toUpperCase()}</span></td>
          <td>${u.createdAt || '—'}</td>
          <td>
            ${isProtected
              ? '<span style="font-size: 0.78rem; color: var(--text-secondary);">Active / Protected</span>'
              : `<button type="button" class="danger-mini-btn" data-delete-user="${u.username}">Remove</button>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetUsername = btn.dataset.deleteUser;
        await fetch(`/api/users/${encodeURIComponent(targetUsername)}`, {
          method: 'DELETE'
        });
        await renderAdminRosterTable(currentUser);
      });
    });
  } catch (err) {
    console.error('Failed to load crew roster:', err);
  }
}

// =========================================================
// 1. SQLITE-BACKED TELEMETRY, GHQ-28 & LONGITUDINAL HISTORY
// =========================================================
let cachedTelemetry = null;
let cachedGhq = null;
let cachedHistory = [];

async function loadUserAssessmentState(username) {
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(username)}`);
    const rows = await res.json();
    const list = Array.isArray(rows) ? rows : [];

    cachedHistory = list.filter(r => r.telemetry && Object.keys(r.telemetry).length > 0 && r.ghq);

    for (let i = list.length - 1; i >= 0; i--) {
      if (!cachedTelemetry && list[i].telemetry && Object.keys(list[i].telemetry).length > 0) {
        cachedTelemetry = list[i].telemetry;
      }
      if (!cachedGhq && list[i].ghq) {
        cachedGhq = list[i].ghq;
      }
      if (cachedTelemetry && cachedGhq) break;
    }
  } catch (e) {
    console.error('Failed to hydrate user assessment history:', e);
  }
  return { telemetry: cachedTelemetry, ghq: cachedGhq, history: cachedHistory };
}

async function saveUserTelemetry(username, payload) {
  cachedTelemetry = payload;
  const physEval = evaluateTelemetry(payload);
  await fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      telemetry: payload,
      physicalScore: physEval.physicalScore
    })
  });
}

async function clearUserTelemetry(username) {
  cachedTelemetry = null;
  cachedGhq = null;
  await fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      telemetry: {},
      physicalScore: null
    })
  });
}

async function saveUserGhq(username, ghqResult) {
  cachedGhq = ghqResult;
  await fetch('/api/ghq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      ghq: ghqResult
    })
  });
}

function renderEmptyStateHtml(title, description, ctaText, targetFile) {
  return `
    <div class="empty-state-icon">00</div>
    <h3>${title}</h3>
    <p>${description}</p>
    <a href="${targetFile}" class="cta-btn">
      ${ctaText}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </a>
  `;
}

// =========================================================
// 2. DEEP-SPACE TWINKLING STARFIELD
// =========================================================
function initStarfield() {
  const container = document.getElementById('starfield');
  if (!container) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 95; i++) {
    const star = document.createElement('span');
    star.className = 'star';
    const size = (Math.random() * 2.2 + 1).toFixed(1);
    star.style.width = size + 'px';
    star.style.height = size + 'px';
    star.style.left = (Math.random() * 100).toFixed(2) + '%';
    star.style.top = (Math.random() * 100).toFixed(2) + '%';
    star.style.setProperty('--duration', (Math.random() * 4 + 2.5).toFixed(1) + 's');
    star.style.animationDelay = (Math.random() * 4).toFixed(1) + 's';
    frag.appendChild(star);
  }
  container.appendChild(frag);
}

// =========================================================
// 3. MISSION ENVIRONMENT CONFIG & PRESETS
// =========================================================
const ENV_CONFIG = {
  space: {
    label: 'Space (0g)',
    gravity: '0g',
    targetExMin: 135,
    lowSbp: 95,
    minSpo2: 94,
    minVo2: 32.9,
    activityFactor: 1.60,
    proteinPerKg: 1.4,
    fluidPerKg: 33
  },
  moon: {
    label: 'Moon (0.165g)',
    gravity: '0.165g',
    targetExMin: 110,
    lowSbp: 95,
    minSpo2: 93,
    minVo2: 36.5,
    activityFactor: 1.70,
    proteinPerKg: 1.5,
    fluidPerKg: 36
  },
  mars: {
    label: 'Mars (0.376g)',
    gravity: '0.376g',
    targetExMin: 90,
    lowSbp: 95,
    minSpo2: 93,
    minVo2: 36.5,
    activityFactor: 1.75,
    proteinPerKg: 1.5,
    fluidPerKg: 38
  }
};

let selectedAssessmentEnv = 'space';
let selectedRegimenEnv = 'space';
let selectedTrendDays = 7;
let selectedTrendMetric = 'physical';

const TELEMETRY_PRESETS = {
  nominal: {
    age: 36, gender: 'male', height: 178, massKg: 78.0, massMo: 0.0, massTot: 0.0,
    hrRest: 62, hrEx: 142, sbp: 116, dbp: 74, temp: 37.2, rr: 14, spo2: 98,
    sleepHrs: 7.5, sleepQual: 85, exMin: 135, exLoad: 80, kcal: 2750, protein: 110,
    fluids: 2550, radRate: 0.025, radCum: 45, vo2Max: 42.0
  },
  hypotension: {
    age: 38, gender: 'female', height: 168, massKg: 63.0, massMo: -1.4, massTot: -2.6,
    hrRest: 106, hrEx: 162, sbp: 86, dbp: 56, temp: 36.9, rr: 19, spo2: 96,
    sleepHrs: 6.4, sleepQual: 72, exMin: 115, exLoad: 84, kcal: 2250, protein: 90,
    fluids: 1650, radRate: 0.028, radCum: 52, vo2Max: 37.5
  },
  hyperthermia: {
    age: 41, gender: 'male', height: 181, massKg: 81.0, massMo: -0.9, massTot: -1.8,
    hrRest: 112, hrEx: 158, sbp: 122, dbp: 78, temp: 38.6, rr: 24, spo2: 91,
    sleepHrs: 5.5, sleepQual: 58, exMin: 90, exLoad: 88, kcal: 2300, protein: 98,
    fluids: 1800, radRate: 0.03, radCum: 60, vo2Max: 35.0
  },
  radiation: {
    age: 35, gender: 'male', height: 176, massKg: 75.5, massMo: -0.4, massTot: -1.2,
    hrRest: 76, hrEx: 146, sbp: 118, dbp: 76, temp: 37.3, rr: 16, spo2: 97,
    sleepHrs: 5.8, sleepQual: 62, exMin: 120, exLoad: 78, kcal: 2600, protein: 105,
    fluids: 2400, radRate: 1.35, radCum: 165, vo2Max: 40.5
  },
  weightfatigue: {
    age: 39, gender: 'female', height: 170, massKg: 61.5, massMo: -2.8, massTot: -5.4,
    hrRest: 84, hrEx: 154, sbp: 104, dbp: 68, temp: 37.0, rr: 17, spo2: 96,
    sleepHrs: 5.4, sleepQual: 55, exMin: 145, exLoad: 98, kcal: 1850, protein: 72,
    fluids: 1850, radRate: 0.032, radCum: 72, vo2Max: 31.2
  }
};

function populateAssessmentFields(p, isNominal) {
  const envCfg = ENV_CONFIG[selectedAssessmentEnv] || ENV_CONFIG.space;
  document.getElementById('in-age').value = p.age;
  document.getElementById('in-gender').value = p.gender;
  document.getElementById('in-height').value = p.height;
  document.getElementById('in-mass-kg').value = p.massKg;
  document.getElementById('in-mass-mo').value = p.massMo;
  document.getElementById('in-mass-tot').value = p.massTot;
  document.getElementById('in-hr-rest').value = p.hrRest;
  document.getElementById('in-hr-ex').value = p.hrEx;
  document.getElementById('in-sbp').value = p.sbp;
  document.getElementById('in-dbp').value = p.dbp;
  document.getElementById('in-temp').value = p.temp;
  document.getElementById('in-rr').value = p.rr;
  document.getElementById('in-spo2').value = p.spo2;
  document.getElementById('in-sleep-hrs').value = p.sleepHrs;
  document.getElementById('in-sleep-qual').value = p.sleepQual;
  document.getElementById('in-ex-min').value = isNominal ? envCfg.targetExMin : p.exMin;
  document.getElementById('in-ex-load').value = p.exLoad;
  document.getElementById('in-kcal').value = p.kcal;
  document.getElementById('in-protein').value = p.protein;
  document.getElementById('in-fluids').value = p.fluids;
  document.getElementById('in-rad-rate').value = p.radRate;
  document.getElementById('in-rad-cum').value = p.radCum;
  document.getElementById('in-vo2-max').value = p.vo2Max;
}

async function applyAssessmentPreset(presetKey, username) {
  const form = document.getElementById('assessmentForm');
  if (!form) return;

  if (presetKey === 'clear') {
    form.reset();
    if (username) await clearUserTelemetry(username);
    return;
  }

  const p = TELEMETRY_PRESETS[presetKey];
  if (!p) return;
  populateAssessmentFields(p, presetKey === 'nominal');
}

// =========================================================
// 4. TELEMETRY EVALUATION & NASA RISK ENGINE
// =========================================================
function calculateBiometrics(t) {
  const hMeters = t.height / 100;
  const bmi = Number((t.massKg / (hMeters * hMeters)).toFixed(1));
  const bmr = t.gender === 'female'
    ? Math.round(10 * t.massKg + 6.25 * t.height - 5 * t.age - 161)
    : Math.round(10 * t.massKg + 6.25 * t.height - 5 * t.age + 5);
  const maxHr = Math.round(208 - 0.7 * t.age);
  return { bmi, bmr, maxHr };
}

function evaluateTelemetry(t) {
  const envCfg = ENV_CONFIG[t.env] || ENV_CONFIG.space;
  const bio = calculateBiometrics(t);
  const physicalFindings = [];
  const nasaRisks = [];
  let deductions = 0;

  if (t.hrRest > 100 || t.hrRest < 45 || t.hrEx > bio.maxHr) {
    const isHigh = t.hrRest > 100 || t.hrEx > bio.maxHr;
    deductions += 12;
    physicalFindings.push({
      title: isHigh ? 'Elevated Cardiac Rate (Tachycardia / Strain)' : 'Low Resting Heart Rate (Bradycardia)',
      reading: `Resting ${t.hrRest} bpm • Exercise ${t.hrEx} bpm (Max ${bio.maxHr} bpm)`,
      summary: isHigh
        ? 'Your heart is working harder than normal at rest or during exertion, often caused by dehydration, fever, or autonomic stress.'
        : 'Your resting pulse is unusually slow, which requires flight surgeon rhythm verification.',
      steps: [
        '<strong>Pause intense exercise:</strong> Stop treadmill or resistive loading immediately and rest in a seated or supine position.',
        '<strong>Rehydrate slowly:</strong> Drink 400–500 mL of electrolyte fluid over the next 20 minutes.',
        '<strong>Re-check ECG & pulse:</strong> Measure resting heart rate again in 15 minutes and notify Flight Surgeon if resting HR stays above 100 bpm.'
      ]
    });
  }

  if (t.sbp < envCfg.lowSbp || t.dbp < 60) {
    deductions += 14;
    physicalFindings.push({
      title: 'Low Blood Pressure (Hypotension / Orthostatic Risk)',
      reading: `${t.sbp}/${t.dbp} mmHg (Target ≥ ${envCfg.lowSbp}/60 mmHg)`,
      summary: 'Your blood pressure is below safe mission limits, increasing the risk of dizziness, tunnel vision, or fainting when standing or operating controls.',
      steps: [
        '<strong>Assume supine / legs-elevated posture:</strong> Lie flat or elevate lower limbs to restore blood flow to the brain.',
        '<strong>Execute rapid fluid & salt loading:</strong> Consume 500–750 mL of electrolyte-sodium solution immediately.',
        '<strong>Engage lower-body compression:</strong> Activate lower-body compression garments before standing or starting EVA prep.'
      ]
    });
    nasaRisks.push({
      title: 'Orthostatic Intolerance & Cardiovascular Deconditioning',
      trigger: `BP ${t.sbp}/${t.dbp} mmHg • Resting HR ${t.hrRest} bpm`,
      summary: 'Fluid shifts in reduced gravity shrink plasma volume, making it harder for blood vessels to maintain pressure when upright.',
      mitigation: [
        '<strong>Follow fluid-loading protocol:</strong> Maintain steady daily hydration and sodium balance before gravity transitions.',
        '<strong>Perform lower-body resistance work:</strong> Resume calf and leg-press loading once blood pressure stabilizes above 100/65 mmHg.'
      ]
    });
  } else if (t.sbp >= 140 || t.dbp >= 90) {
    deductions += 10;
    physicalFindings.push({
      title: 'Elevated Blood Pressure (Hypertension)',
      reading: `${t.sbp}/${t.dbp} mmHg (Target < 130/85 mmHg)`,
      summary: 'Your arterial pressure is elevated above baseline, placing extra strain on blood vessels and ocular fluid pressure.',
      steps: [
        '<strong>Rest quietly for 15 minutes:</strong> Avoid caffeine, stimulants, and heavy isometric breath-holding (Valsalva maneuver).',
        '<strong>Limit sodium intake:</strong> Keep dietary sodium strictly below 2,000 mg for the next 24 hours.',
        '<strong>Log repeat BP reading:</strong> Re-measure blood pressure after calm breathing exercises.'
      ]
    });
  }

  if (t.temp >= 38.0 || t.temp < 36.0) {
    const isFever = t.temp >= 38.0;
    deductions += 16;
    physicalFindings.push({
      title: isFever ? 'Elevated Core Temperature (Fever / Hyperthermia)' : 'Low Core Temperature (Hypothermia)',
      reading: `${t.temp.toFixed(1)} °C (Normal 36.4–37.6 °C)`,
      summary: isFever
        ? 'Your body temperature indicates a fever or heat-stress response, which accelerates fluid loss and cardiovascular strain.'
        : 'Your core temperature has dropped below normal thermal balance, impairing dexterity and metabolism.',
      steps: isFever ? [
        '<strong>Suspend all physical workouts:</strong> Cancel scheduled cardio and ARED sessions until core temperature stays below 37.5 °C for 24 hours.',
        '<strong>Activate active cooling & hydration:</strong> Increase cabin airflow/liquid cooling garment flow and drink 750–1,000 mL of cool fluids.',
        '<strong>Screen for infection:</strong> Run onboard symptom and inflammatory biomarker checks with Flight Surgeon.'
      ] : [
        '<strong>Increase thermal insulation:</strong> Move to a warm cabin zone and layer thermal garments.',
        '<strong>Consume warm fluids & calories:</strong> Drink warm electrolyte beverages and high-energy carbohydrates.',
        '<strong>Monitor core temp every 20 min:</strong> Escalate to medical support if temperature remains below 36.0 °C.'
      ]
    });
  }

  if (t.spo2 < envCfg.minSpo2 || t.rr < 10 || t.rr > 22) {
    deductions += 16;
    physicalFindings.push({
      title: 'Low Blood Oxygen or Labored Breathing (Hypoxia Alert)',
      reading: `SpO₂ ${t.spo2}% (Target ≥ ${envCfg.minSpo2}%) • RR ${t.rr} br/min`,
      summary: 'Blood oxygen saturation or breathing rate is outside safe limits, risking impaired judgment, fatigue, and tissue hypoxia.',
      steps: [
        '<strong>Verify cabin & suit O₂ partial pressure:</strong> Check environmental life-support O₂/CO₂ scrubbers and mask seal immediately.',
        '<strong>Administer supplemental oxygen:</strong> Switch to 100% O₂ breathing loop if SpO₂ stays below 93%.',
        '<strong>Halt physical exertion:</strong> Remain at rest until pulse oximetry stabilizes above 95%.'
      ]
    });
    nasaRisks.push({
      title: 'Hypoxia & Decompression Sickness (DCS) Risk',
      trigger: `SpO₂ ${t.spo2}% • Resp Rate ${t.rr} br/min`,
      summary: 'Reduced cabin or suit oxygen partial pressure or rapid pressure changes can trigger tissue hypoxia or nitrogen bubble formation.',
      mitigation: [
        '<strong>Verify suit pressure integrity:</strong> Complete full pressure and oxygen pre-breathe checks before any airlock operation.',
        '<strong>Scrub cabin CO₂ levels:</strong> Confirm cabin CO₂ remains below 3.0 mmHg to prevent respiratory acidosis.'
      ]
    });
  }

  const minKcalBase = Math.round(bio.bmr * envCfg.activityFactor);
  const minProteinBase = Math.round(t.massKg * envCfg.proteinPerKg);
  const minFluidsBase = Math.round(t.massKg * envCfg.fluidPerKg);

  if (t.massMo <= -2.0 || t.massTot <= -5.0 || bio.bmi < 18.5) {
    deductions += 10;
    physicalFindings.push({
      title: 'Unintended Body Mass Loss (Catabolic Deficit)',
      reading: `${t.massKg} kg (Monthly ${t.massMo > 0 ? '+' : ''}${t.massMo}% • Mission ${t.massTot > 0 ? '+' : ''}${t.massTot}%)`,
      summary: 'You are losing body mass faster than safe mission limits, which accelerates muscle wasting and bone density loss.',
      steps: [
        '<strong>Add +350 kcal/day energy surplus:</strong> Your Diet & Workout plan has been automatically boosted with extra energy-dense meals.',
        '<strong>Prioritize protein at every meal:</strong> Aim for at least 25–30 g of high-quality protein 4–5 times daily.',
        '<strong>Log pre-breakfast body mass:</strong> Track mass every 48 hours to confirm weight stabilization.'
      ]
    });
    nasaRisks.push({
      title: 'Spaceflight Nutrition Deficit & Lean Muscle Catabolism',
      trigger: `Mass Change ${t.massMo}%/mo (${t.massTot}% total) • Intake ${t.kcal} kcal`,
      summary: 'Sustained caloric deficits in space force the body to break down skeletal muscle and bone matrix for energy.',
      mitigation: [
        '<strong>Follow the +350 kcal surplus meal schedule:</strong> Complete all five scheduled meal blocks even when appetite is blunted.',
        '<strong>Combine protein with ARED loading:</strong> Consume a protein-carb recovery snack within 30 minutes after resistance workouts.'
      ]
    });
  }

  if (t.sleepHrs < 6.0 || t.sleepQual < 70) {
    deductions += 8;
    physicalFindings.push({
      title: 'Sleep Deprivation & Circadian Disruption',
      reading: `${t.sleepHrs} hrs/night • Sleep Quality ${t.sleepQual}%`,
      summary: 'Insufficient or fragmented sleep reduces reaction speed, memory accuracy, immune defense, and emotional resilience.',
      steps: [
        '<strong>Schedule a 90-minute recovery sleep block:</strong> Coordinate with mission control to protect your next sleep window.',
        '<strong>Enforce blue-light & caffeine cutoff:</strong> Stop caffeine 8 hours before sleep and switch cabin lighting to warm dim spectrum 60 minutes prior.',
        '<strong>Use acoustic & thermal sleep shielding:</strong> Wear noise-attenuating sleep gear and keep sleep station cool.'
      ]
    });
    nasaRisks.push({
      title: 'Circadian Desynchronization & Cognitive Fatigue Risk',
      trigger: `Sleep ${t.sleepHrs} hrs • Quality ${t.sleepQual}%`,
      summary: 'Rapid orbital sunrises and high mission tempo disrupt melatonin rhythms, increasing human-error risk on critical tasks.',
      mitigation: [
        '<strong>Defer high-risk manual tasks:</strong> Postpone non-urgent EVA or robotic arm operations until after a full recovery sleep cycle.',
        '<strong>Use morning bright-light exposure:</strong> Expose eyes to blue-enriched light immediately upon waking to anchor circadian rhythm.'
      ]
    });
  }

  if (t.exMin < envCfg.targetExMin * 0.75) {
    deductions += 8;
    physicalFindings.push({
      title: 'Below-Target Countermeasure Exercise Volume',
      reading: `${t.exMin} min/day logged (Target ${envCfg.targetExMin} min/day for ${envCfg.label})`,
      summary: 'Daily mechanical loading is below the minimum needed to protect bone density and heart muscle in reduced gravity.',
      steps: [
        '<strong>Complete full ARED + aerobic blocks:</strong> Aim for the full daily target whenever medically cleared.',
        '<strong>Split into two shorter sessions if needed:</strong> Perform 45 min morning cardio and 45–60 min afternoon resistance training.'
      ]
    });
    nasaRisks.push({
      title: 'Bone Mineral Density Loss & Renal Stone Risk',
      trigger: `Exercise ${t.exMin}/${envCfg.targetExMin} min/day in ${envCfg.gravity}`,
      summary: 'Without daily axial skeletal loading, bones release calcium into the bloodstream, weakening bone strength and raising kidney stone risk.',
      mitigation: [
        '<strong>Prioritize heavy axial ARED lifts:</strong> Focus on squats, deadlifts, and heel raises to load the hip and lumbar spine.',
        '<strong>Maintain high fluid output:</strong> Drink at least 2.5 L of water daily alongside potassium citrate prophylaxis if prescribed.'
      ]
    });
  } else if (t.exLoad > 95) {
    deductions += 6;
    physicalFindings.push({
      title: 'Excessive Training Strain (Overreaching Alert)',
      reading: `Exercise Workload ${t.exLoad}% • ${t.exMin} min/day`,
      summary: 'Training intensity is near maximum capacity, which can cause joint inflammation, suppressed immunity, and persistent fatigue.',
      steps: [
        '<strong>Scale down to Zone 2 recovery intensity:</strong> Your Diet & Workout plan has automatically lowered cardio intensity for 48 hours.',
        '<strong>Extend mobility & stretching:</strong> Add 10 minutes of spinal decompression and hip mobility work.'
      ]
    });
  }

  if (t.kcal < minKcalBase * 0.85 || t.fluids < minFluidsBase * 0.85 || t.protein < minProteinBase * 0.85) {
    deductions += 8;
    physicalFindings.push({
      title: 'Sub-Optimal Caloric, Protein, or Fluid Intake',
      reading: `${t.kcal} kcal | ${t.protein} g protein | ${t.fluids} mL fluids`,
      summary: 'Your logged daily food or water intake is below your body-mass minimum, risking dehydration and low energy.',
      steps: [
        '<strong>Close the hydration gap immediately:</strong> Drink 500 mL of water or electrolyte mix over the next hour.',
        '<strong>Add an extra nutrient-dense snack:</strong> Include mixed nuts, Greek yogurt, or a protein recovery shake before sleep.'
      ]
    });
  }

  if (t.radRate > 0.50 || t.radCum > 150) {
    const isAcuteSpe = t.radRate > 0.50;
    deductions += isAcuteSpe ? 18 : 10;
    physicalFindings.push({
      title: isAcuteSpe ? 'Solar Particle Event (High Radiation Dose Rate)' : 'Elevated Cumulative Radiation Dose',
      reading: `Dose Rate ${t.radRate.toFixed(3)} mSv/h • Cumulative ${t.radCum} mSv`,
      summary: isAcuteSpe
        ? 'Ambient ionizing radiation has spiked above safe limits due to solar particle activity.'
        : 'Cumulative mission radiation exposure has crossed the elevated monitoring threshold.',
      steps: isAcuteSpe ? [
        '<strong>Move to the Storm Shelter immediately:</strong> Relocate to the highest-shielded water/polyethylene core module until dose rate drops below 0.10 mSv/h.',
        '<strong>Cancel all EVAs & unshielded workouts:</strong> Remain inside shielded quarters with personal dosimeter active.',
        '<strong>Take antioxidant & radioprotective nutrition:</strong> Ensure full Vitamin C, Vitamin E, and hydration intake.'
      ] : [
        '<strong>Minimize unshielded time:</strong> Limit time near thin-hulled viewports and defer non-essential EVAs.',
        '<strong>Maximize dietary antioxidants:</strong> Consume berries, citrus, omega-3s, and Vitamin C/E rich foods daily.'
      ]
    });
    nasaRisks.push({
      title: 'Space Radiation Carcinogenesis & Central Nervous System Risk',
      trigger: `Rate ${t.radRate.toFixed(3)} mSv/h • Cumulative ${t.radCum} mSv`,
      summary: 'High-energy solar protons and galactic cosmic rays can damage cellular DNA and increase long-term tissue degeneration risk.',
      mitigation: [
        '<strong>Maximize hydrogen-rich shielding:</strong> Sleep and work in areas surrounded by water storage tanks and polyethylene shielding.',
        '<strong>Maintain antioxidant micronutrient defense:</strong> Meet daily Vitamin C (90+ mg), Vitamin E (15+ mg), and selenium targets.'
      ]
    });
  }

  if (t.vo2Max < envCfg.minVo2) {
    deductions += 8;
    physicalFindings.push({
      title: 'Reduced Aerobic Capacity (VO₂ max Below Mission Floor)',
      reading: `${t.vo2Max.toFixed(1)} mL/kg/min (Mission Minimum ≥ ${envCfg.minVo2} mL/kg/min)`,
      summary: 'Your cardiorespiratory fitness has dipped below the mission readiness floor needed for strenuous EVA tasks.',
      steps: [
        '<strong>Follow structured aerobic base intervals:</strong> Your Workout Plan has shifted Block 1 to progressive interval conditioning.',
        '<strong>Defer high-exertion EVAs until re-tested:</strong> Re-assess submaximal VO₂ max after 10 days of targeted conditioning.'
      ]
    });
    nasaRisks.push({
      title: 'Aerobic Deconditioning & Reduced EVA Work Capacity',
      trigger: `VO₂ max ${t.vo2Max.toFixed(1)} mL/kg/min (< ${envCfg.minVo2} floor)`,
      summary: 'Microgravity reduces stroke volume and red blood cell mass, lowering peak oxygen delivery during demanding spacewalks.',
      mitigation: [
        '<strong>Perform 4×4 min aerobic intervals 3×/week:</strong> Train at 78%–85% HRmax on CEVIS cycle or T2 treadmill.',
        '<strong>Ensure adequate iron & hydration:</strong> Support red blood cell oxygen transport with balanced iron and fluid intake.'
      ]
    });
  }

  if (t.env === 'space' && nasaRisks.length === 0) {
    nasaRisks.push({
      title: 'Spaceflight-Associated Neuro-ocular Syndrome (SANS) Monitoring',
      trigger: 'Baseline Microgravity (0g) Fluid Shift Exposure',
      summary: 'Weightlessness shifts fluids toward the head, which can gradually increase intracranial and optic nerve pressure over multi-month missions.',
      mitigation: [
        '<strong>Complete routine OCT retinal & visual acuity scans:</strong> Report any near-vision blurriness or headaches early.',
        '<strong>Maintain moderate sodium & B-vitamin intake:</strong> Keep sodium below 2,300 mg/day and ensure adequate folate and B12.'
      ]
    });
  }

  const physicalScore = Math.max(0, Math.min(100, 100 - deductions));
  const isAlert = physicalScore < 85 || physicalFindings.some(f =>
    f.title.includes('Hypotension') ||
    f.title.includes('Fever') ||
    f.title.includes('Hypoxia') ||
    f.title.includes('Solar Particle')
  );

  return {
    envCfg,
    bio,
    physicalScore,
    isAlert,
    physicalFindings,
    nasaRisks
  };
}

// =========================================================
// 5. GHQ-28 QUESTIONNAIRE RENDERING, PROGRESS & SCORING
// =========================================================
const GHQ28_SECTIONS = [
  {
    id: 'A',
    title: 'Subscale A: Somatic Symptoms',
    questions: [
      '1. Been feeling perfectly well and in good health?',
      '2. Been feeling in need of a good tonic / energy boost?',
      '3. Been feeling run down and out of sorts?',
      '4. Felt that you are ill?',
      '5. Been getting any pains in your head?',
      '6. Been getting a feeling of tightness or pressure in your head?',
      '7. Been having hot or cold spells?'
    ],
    options: ['Better than usual', 'Same as usual', 'Worse than usual', 'Much worse than usual']
  },
  {
    id: 'B',
    title: 'Subscale B: Anxiety & Insomnia',
    questions: [
      '8. Lost much sleep over worry?',
      '9. Had difficulty in staying asleep once you are off?',
      '10. Felt constantly under strain?',
      '11. Been getting edgy and bad-tempered?',
      '12. Been getting scared or panicky for no good reason?',
      '13. Found everything getting on top of you?',
      '14. Been feeling nervous and strung-up all the time?'
    ],
    options: ['Not at all', 'No more than usual', 'Rather more than usual', 'Much more than usual']
  },
  {
    id: 'C',
    title: 'Subscale C: Social Dysfunction',
    questions: [
      '15. Been managing to keep yourself busy and occupied?',
      '16. Been taking longer over the things you do?',
      '17. Felt on the whole you were doing things well?',
      '18. Been satisfied with the way you have carried out your task?',
      '19. Felt that you are playing a useful part in things?',
      '20. Felt capable of making decisions about things?',
      '21. Been able to enjoy your normal day-to-day activities?'
    ],
    options: ['More so than usual', 'Same as usual', 'Less so than usual', 'Much less so than usual']
  },
  {
    id: 'D',
    title: 'Subscale D: Severe Depression',
    questions: [
      '22. Been thinking of yourself as a worthless person?',
      '23. Felt that life is entirely hopeless?',
      '24. Felt that life is not worth living?',
      '25. Thought of the possibility that you might make away with yourself?',
      '26. Found at times you could not do anything because your nerves were too bad?',
      '27. Found yourself wishing you were dead and away from it all?',
      '28. Found that the idea of taking your own life kept coming into your mind?'
    ],
    options: ['Not at all', 'No more than usual', 'Rather more than usual', 'Much more than usual']
  }
];

function buildGhq28Questionnaire() {
  const container = document.getElementById('ghq28Container');
  if (!container) return;

  let qIndex = 0;
  container.innerHTML = GHQ28_SECTIONS.map(sec => {
    const itemsHtml = sec.questions.map(qText => {
      const currentIdx = qIndex++;
      const optsHtml = sec.options.map((optLabel, optVal) => `
        <label class="ghq-option-label">
          <input type="radio" name="ghq_q_${currentIdx}" value="${optVal}" />
          <span>${optLabel}</span>
        </label>
      `).join('');

      return `
        <div class="ghq-item" id="ghq-item-${currentIdx}">
          <div class="ghq-question-text">${qText}</div>
          <div class="ghq-options">${optsHtml}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="ghq-subscale">
        <div class="ghq-subscale-header">
          <h3>${sec.title}</h3>
          <span class="ghq-subscale-tag">7 ITEMS • CLINICAL SUBSCALE ${sec.id}</span>
        </div>
        ${itemsHtml}
      </div>
    `;
  }).join('');

  container.addEventListener('change', updateGhqProgress);
}

function updateGhqProgress() {
  const form = document.getElementById('ghq28Form');
  if (!form) return;
  let answered = 0;
  for (let i = 0; i < 28; i++) {
    if (form.querySelector(`input[name="ghq_q_${i}"]:checked`)) {
      answered++;
      const itemEl = document.getElementById(`ghq-item-${i}`);
      if (itemEl) itemEl.classList.remove('missing-highlight');
    }
  }
  const pct = Math.round((answered / 28) * 100);
  const fill = document.getElementById('ghqProgressFill');
  const text = document.getElementById('ghqProgressText');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${answered} / 28 ANSWERED`;

  if (answered === 28) {
    const notice = document.getElementById('ghqValidationNotice');
    if (notice) notice.style.display = 'none';
  }
}

function fillGhqDemo(mode) {
  const form = document.getElementById('ghq28Form');
  if (!form) return;

  for (let i = 0; i < 28; i++) {
    let val = 0;
    if (mode === 'normal') {
      val = 1;
    } else if (mode === 'distress') {
      if (i < 7) val = i % 2 === 0 ? 2 : 1;
      else if (i < 14) val = i < 12 ? 2 : 3;
      else if (i < 21) val = i % 2 === 1 ? 2 : 1;
      else val = i === 25 ? 2 : 0;
    }
    const radio = form.querySelector(`input[name="ghq_q_${i}"][value="${val}"]`);
    if (radio) radio.checked = true;
  }
  updateGhqProgress();
}

function scoreGhq28Responses(responses) {
  const binaryMap = [0, 0, 1, 1];
  const subscales = { A: 0, B: 0, C: 0, D: 0 };
  const keys = ['A', 'B', 'C', 'D'];

  responses.forEach((rawVal, idx) => {
    const bin = binaryMap[rawVal] || 0;
    const secKey = keys[Math.floor(idx / 7)];
    subscales[secKey] += bin;
  });

  const totalDistress = subscales.A + subscales.B + subscales.C + subscales.D;
  const mentalScore = Math.max(0, Math.min(100, Math.round(((28 - totalDistress) / 28) * 100)));
  const isAlert = totalDistress >= 5 || subscales.D >= 1;

  return {
    responses,
    subscales,
    totalDistress,
    mentalScore,
    isAlert
  };
}

// =========================================================
// 6. STICKMAN SVG GAUGES, HEALTH SCORE & LONGITUDINAL GRAPHS
// =========================================================
function updateStickmanGauge(rectId, textId, headlineId, subtextId, pct, isAlert, fillColor, normalMsg, alertMsg, normalSub, alertSub) {
  const rect = document.getElementById(rectId);
  const pctText = document.getElementById(textId);
  const headline = document.getElementById(headlineId);
  const subtext = document.getElementById(subtextId);

  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const totalHeight = 190;
  const topY = 12;
  const fillHeight = Math.round((totalHeight * clamped) / 100);
  const fillY = topY + (totalHeight - fillHeight);

  if (rect) {
    rect.setAttribute('y', String(fillY));
    rect.setAttribute('height', String(fillHeight));
    rect.setAttribute('fill', fillColor);
  }
  if (pctText) pctText.textContent = clamped + '%';
  if (headline) {
    headline.textContent = isAlert ? alertMsg : normalMsg;
    headline.className = 'stickman-headline ' + (isAlert ? 'alert' : 'nominal');
  }
  if (subtext) subtext.textContent = isAlert ? alertSub : normalSub;
}

const TREND_METRIC_CONFIG = {
  physical: {
    unit: '%',
    min: 40,
    max: 100,
    series: [{ key: 'physicalScore', label: 'Physical Health (%)', color: '#F43F5E' }]
  },
  mental: {
    unit: '%',
    min: 40,
    max: 100,
    series: [{ key: 'mentalScore', label: 'Mental Health (%)', color: '#38BDF8' }]
  },
  hr: {
    unit: ' bpm',
    min: 40,
    max: 125,
    series: [{ key: 'hrRest', label: 'Resting Heart Rate (bpm)', color: '#38BDF8' }]
  },
  sbp: {
    unit: ' mmHg',
    min: 75,
    max: 155,
    series: [{ key: 'sbp', label: 'Systolic Blood Pressure (mmHg)', color: '#FBBF24' }]
  },
  dbp: {
    unit: ' mmHg',
    min: 45,
    max: 105,
    series: [{ key: 'dbp', label: 'Diastolic Blood Pressure (mmHg)', color: '#10B981' }]
  },
  temp: {
    unit: ' °C',
    min: 35,
    max: 40,
    series: [{ key: 'temp', label: 'Core Temperature (°C)', color: '#F43F5E' }]
  },
  spo2: {
    unit: '%',
    min: 88,
    max: 100,
    series: [{ key: 'spo2', label: 'Blood Oxygen SpO₂ (%)', color: '#38BDF8' }]
  },
  mass: {
    unit: ' kg',
    min: 45,
    max: 110,
    series: [{ key: 'massKg', label: 'Body Mass (kg)', color: '#FBBF24' }]
  },
  sleep: {
    unit: ' hrs',
    min: 3,
    max: 11,
    series: [{ key: 'sleepHrs', label: 'Sleep Duration (hrs)', color: '#818CF8' }]
  },
  vo2: {
    unit: ' mL/kg/min',
    min: 25,
    max: 60,
    series: [{ key: 'vo2Max', label: 'Aerobic Capacity VO₂ Max (mL/kg/min)', color: '#10B981' }]
  }
};

function renderLongitudinalTrends() {
  const svg = document.getElementById("longitudinalSvg");
  const trendCard = svg ? svg.closest(".trends-panel") : null;
  if (!svg) return;

  const history = cachedHistory;
  if (history.length === 0) {
    if (trendCard) trendCard.style.display = "none";
    return;
  }
  if (trendCard) trendCard.style.display = "block";

  const cfg = TREND_METRIC_CONFIG[selectedTrendMetric] || TREND_METRIC_CONFIG.physical;

  document.querySelectorAll(".tf-btn").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.days) === selectedTrendDays);
  });
  document.querySelectorAll(".metric-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.metric === selectedTrendMetric);
  });

  const byDate = new Map(history.map(item => [item.date, item]));
  const latestDateStr = history[history.length - 1].date;
  const endDate = new Date(latestDateStr + "T00:00:00");
  const totalDays = Math.max(1, selectedTrendDays);

  const timeline = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(endDate.getDate() - i);
    const iso = d.toISOString().split("T")[0];
    timeline.push({ date: iso, data: byDate.get(iso) || null });
  }

  const recorded = timeline.filter(slot => slot.data !== null).map(slot => slot.data);

  const kpiStrip = document.getElementById("trendKpiStrip");
  if (kpiStrip && recorded.length > 0) {
    const primaryKey = cfg.series[0].key;
    const vals = recorded.map(d => Number(d[primaryKey]));
    const latest = vals[vals.length - 1];
    const first = vals[0];
    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const delta = Number((latest - first).toFixed(1));

    kpiStrip.innerHTML = `
      <div class="trend-kpi-card">
        <span class="trend-kpi-label">Latest Reading</span>
        <span class="trend-kpi-val">${latest}${cfg.unit}</span>
        <span class="trend-kpi-sub ${delta >= 0 ? "pos" : "neg"}">${recorded.length > 1 ? `${delta >= 0 ? "+" : ""}${delta}${cfg.unit} vs first log in window` : "Initial recorded baseline"}</span>
      </div>
      <div class="trend-kpi-card">
        <span class="trend-kpi-label">${recorded.length}-Log Average</span>
        <span class="trend-kpi-val">${avg}${cfg.unit}</span>
        <span class="trend-kpi-sub">${cfg.series[0].label}</span>
      </div>
      <div class="trend-kpi-card">
        <span class="trend-kpi-label">Recorded Range (Min / Max)</span>
        <span class="trend-kpi-val">${minVal} – ${maxVal}${cfg.unit}</span>
        <span class="trend-kpi-sub">${recorded.length} of ${totalDays} day(s) logged</span>
      </div>
      <div class="trend-kpi-card">
        <span class="trend-kpi-label">Window Span</span>
        <span class="trend-kpi-val">${timeline[0].date.slice(5)} → ${timeline[timeline.length - 1].date.slice(5)}</span>
        <span class="trend-kpi-sub">${totalDays - recorded.length} day(s) with no data</span>
      </div>
    `;
  }

  const legend = document.getElementById("chartLegend");
  if (legend) {
    legend.innerHTML = cfg.series.map(s => `
      <span class="legend-item">
        <span class="legend-swatch" style="background: ${s.color};"></span>
        ${s.label}
      </span>
    `).join("");
  }

  const W = 860, H = 285;
  const padL = 48, padR = 20, padT = 18, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let gridHtml = "";
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const val = cfg.min + ((cfg.max - cfg.min) * i) / ySteps;
    const y = padT + plotH - (plotH * i) / ySteps;
    const formattedTick = Number.isInteger(val) ? val : val.toFixed(1);
    gridHtml += `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.14)" stroke-width="1" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#94A3B8" font-family="JetBrains Mono, monospace" font-size="11">${formattedTick}</text>
    `;
  }

  const getPointX = (idx) => {
    if (timeline.length === 1) return padL + plotW / 2;
    return padL + (plotW * idx) / (timeline.length - 1);
  };

  const xLabelCount = Math.min(6, timeline.length);
  for (let i = 0; i < xLabelCount; i++) {
    const idx = timeline.length === 1 ? 0 : Math.round((i * (timeline.length - 1)) / Math.max(1, xLabelCount - 1));
    const x = getPointX(idx);
    gridHtml += `
      <text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#94A3B8" font-family="JetBrains Mono, monospace" font-size="11">${timeline[idx].date.slice(5)}</text>
    `;
  }

  let pathsHtml = "";
  cfg.series.forEach((s, sIdx) => {
    const segments = [];
    let currentSeg = [];

    timeline.forEach((slot, idx) => {
      if (slot.data && slot.data[s.key] !== undefined && slot.data[s.key] !== null) {
        const x = getPointX(idx);
        const clamped = Math.max(cfg.min, Math.min(cfg.max, Number(slot.data[s.key])));
        const y = padT + plotH - ((clamped - cfg.min) / (cfg.max - cfg.min)) * plotH;
        currentSeg.push({ x, y, val: slot.data[s.key], date: slot.date });
      } else if (currentSeg.length > 0) {
        segments.push(currentSeg);
        currentSeg = [];
      }
    });
    if (currentSeg.length > 0) segments.push(currentSeg);

    segments.forEach(seg => {
      if (seg.length > 1) {
        const d = seg.map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
        pathsHtml += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />`;

        if (sIdx === 0) {
          const areaD = `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
          pathsHtml += `<path d="${areaD}" fill="${s.color}" fill-opacity="0.08" />`;
        }
      }

      seg.forEach(c => {
        pathsHtml += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${recorded.length === 1 ? "5" : "3.5"}" fill="${s.color}" stroke="#03060E" stroke-width="1.5" />`;
      });
    });
  });

  const hoverRects = timeline.map((slot, idx) => {
    const x = getPointX(idx);
    const colW = plotW / Math.max(1, timeline.length);
    return `<rect x="${(x - colW / 2).toFixed(1)}" y="${padT}" width="${colW.toFixed(1)}" height="${plotH}" fill="transparent" class="chart-hover-col" data-idx="${idx}" />`;
  }).join("");

  svg.innerHTML = `${gridHtml}${pathsHtml}<line id="chartHoverGuide" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="4 4" visibility="hidden" />${hoverRects}`;

  const tooltip = document.getElementById("chartTooltip");
  const guide = document.getElementById("chartHoverGuide");
  const stage = svg.closest(".chart-stage");

  svg.querySelectorAll(".chart-hover-col").forEach(rect => {
    rect.addEventListener("mouseenter", () => {
      const idx = Number(rect.dataset.idx);
      const slot = timeline[idx];
      const x = getPointX(idx);
      if (guide) {
        guide.setAttribute("x1", x.toFixed(1));
        guide.setAttribute("x2", x.toFixed(1));
        guide.setAttribute("visibility", "visible");
      }
      if (tooltip && stage) {
        if (!slot.data) {
          tooltip.innerHTML = `
            <div class="chart-tooltip-date">${slot.date}</div>
            <div class="chart-tooltip-row"><span style="color:#94A3B8;">Status:</span> <strong>No Data</strong></div>
          `;
        } else {
          tooltip.innerHTML = `
            <div class="chart-tooltip-date">${slot.date}</div>
            ${cfg.series.map(s => `
              <div class="chart-tooltip-row">
                <span style="color:${s.color};">${s.label.split(" (")[0]}:</span>
                <strong>${slot.data[s.key]}${cfg.unit}</strong>
              </div>
            `).join("")}
          `;
        }
        tooltip.style.display = "block";
        tooltip.style.left = `${(x / W) * 100}%`;
        tooltip.style.top = "38%";
      }
    });
  });

  if (stage) {
    stage.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.style.display = "none";
      if (guide) guide.setAttribute("visibility", "hidden");
    });
  }

  const labelEl = document.getElementById("trendLogCountLabel");
  if (labelEl) {
    labelEl.textContent = `Showing ${recorded.length} logged record(s) across ${totalDays}-day window (${timeline[0].date} to ${timeline[timeline.length - 1].date})`;
  }

  const tbody = document.getElementById("telemetryHistoryTableBody");
  if (tbody) {
    tbody.innerHTML = [...recorded].reverse().map(row => `
      <tr>
        <td style="font-family: var(--font-mono); color: var(--cyan-bright);">${row.date}</td>
        <td><strong>${row.physicalScore}%</strong></td>
        <td><strong>${row.mentalScore}%</strong></td>
        <td>${row.hrRest} bpm</td>
        <td>${row.sbp}/${row.dbp}</td>
        <td>${row.temp}°C / ${row.spo2}%</td>
        <td>${row.massKg} kg / ${row.sleepHrs}h</td>
        <td>${row.vo2Max}</td>
      </tr>
    `).join("");
  }
}

function renderResultsView() {
  const telemetry = cachedTelemetry;
  const ghq = cachedGhq;
  const emptyBox = document.getElementById('resultsEmptyState');
  const contentBox = document.getElementById('resultsContent');

  if (!telemetry || !ghq) {
    if (contentBox) contentBox.style.display = 'none';
    if (emptyBox) {
      emptyBox.style.display = 'flex';
      if (!telemetry) {
        emptyBox.innerHTML = renderEmptyStateHtml(
          'No Health Assessment Data Logged Yet',
          'Complete Step 1 (Health Assessment) and Step 2 (GHQ-28 Questionnaire) to calculate your combined Physical and Mental Health scores.',
          'Start Health Assessment',
          'assessment.html'
        );
      } else {
        emptyBox.innerHTML = renderEmptyStateHtml(
          'GHQ-28 Psychological Screening Required',
          'Your physical telemetry is saved, but you must complete the 28-item GHQ-28 questionnaire before your overall health score can be displayed.',
          'Complete GHQ-28 Questionnaire',
          'questionnaire.html'
        );
      }
    }
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (contentBox) contentBox.style.display = 'block';

  const physEval = evaluateTelemetry(telemetry);
  const badge = document.getElementById('resultsEnvBadge');
  if (badge) {
    badge.innerHTML = `<span class="pulse-dot"></span> ${physEval.envCfg.label.toUpperCase()} • MISSION READINESS`;
  }

  updateStickmanGauge(
    'physicalFillRect', 'physicalPercentText', 'physicalStatusHeadline', 'physicalStatusSubtext',
    physEval.physicalScore, physEval.isAlert, physEval.isAlert ? '#F43F5E' : '#DC2626',
    'Normal — Flight Ready', 'Attention Required — Physiological Alert',
    'All 13 physiological, nutritional, and environmental telemetry parameters are within nominal mission limits.',
    `${physEval.physicalFindings.length} parameter(s) outside mission baseline. Review your Advisory and adapted Diet & Workout plan.`
  );

  updateStickmanGauge(
    'mentalFillRect', 'mentalPercentText', 'mentalStatusHeadline', 'mentalStatusSubtext',
    ghq.mentalScore, ghq.isAlert, ghq.isAlert ? '#F59E0B' : '#2563EB',
    'Normal — Psychologically Resilient', 'Support Recommended — Elevated Distress',
    `GHQ-28 distress score is ${ghq.totalDistress}/28, indicating stable mood, sleep, and cognitive focus.`,
    `GHQ-28 distress score is ${ghq.totalDistress}/28. Review targeted behavioral support and recovery adjustments.`
  );

  renderLongitudinalTrends();
}

// =========================================================
// 7. ADVISORY & NASA RISK VIEW RENDERING
// =========================================================
function renderAdvisoryView() {
  const telemetry = cachedTelemetry;
  const ghq = cachedGhq;
  const emptyBox = document.getElementById('advisoryEmptyState');
  const contentBox = document.getElementById('advisoryContent');

  if (!telemetry || !ghq) {
    if (contentBox) contentBox.style.display = 'none';
    if (emptyBox) {
      emptyBox.style.display = 'flex';
      if (!telemetry) {
        emptyBox.innerHTML = renderEmptyStateHtml(
          'No Assessment Data Available for Advisory',
          'Fill in your Health Assessment and GHQ-28 Questionnaire first so AstrumCare can generate personalized medical countermeasures and spaceflight risk warnings.',
          'Start Health Assessment',
          'assessment.html'
        );
      } else {
        emptyBox.innerHTML = renderEmptyStateHtml(
          'Complete GHQ-28 to Unlock Full Advisory',
          'Your physical telemetry is logged. Complete the GHQ-28 Questionnaire to generate your combined physical and psychological advisory.',
          'Complete GHQ-28 Questionnaire',
          'questionnaire.html'
        );
      }
    }
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (contentBox) contentBox.style.display = 'block';

  const physEval = evaluateTelemetry(telemetry);
  const envBadge = document.getElementById('advisoryEnvBadge');
  if (envBadge) {
    envBadge.innerHTML = `<span class="pulse-dot"></span> ${physEval.envCfg.label.toUpperCase()} • CLINICAL ADVISORY`;
  }

  const scoreStrip = document.getElementById('advisoryScoreStrip');
  if (scoreStrip) {
    scoreStrip.innerHTML = `
      <div class="summary-pill-item">
        <span class="summary-pill-label">Mission Environment</span>
        <span class="summary-pill-value">${physEval.envCfg.label}</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Physical Readiness</span>
        <span class="summary-pill-value ${physEval.isAlert ? 'warn' : 'ok'}">${physEval.physicalScore}% (${physEval.isAlert ? 'Alert' : 'Normal'})</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Mental Readiness (GHQ-28)</span>
        <span class="summary-pill-value ${ghq.isAlert ? 'warn' : 'ok'}">${ghq.mentalScore}% (${ghq.totalDistress}/28 Distress)</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Active Risk Warnings</span>
        <span class="summary-pill-value ${physEval.nasaRisks.length > 1 || physEval.isAlert ? 'warn' : 'ok'}">${physEval.nasaRisks.length} Flagged</span>
      </div>
    `;
  }

  const physBadge = document.getElementById('physicalAdvisoryBadge');
  const physList = document.getElementById('physicalAdvisoryList');
  if (physEval.physicalFindings.length === 0) {
    if (physBadge) {
      physBadge.className = 'status-pill normal';
      physBadge.textContent = 'ALL PARAMETERS NORMAL';
    }
    if (physList) {
      physList.innerHTML = `
        <div class="advisory-card">
          <div class="advisory-card-header">
            <h3 class="advisory-card-title">All Physiological Parameters Within Baseline</h3>
            <span class="advisory-card-meta">HR ${telemetry.hrRest} bpm • BP ${telemetry.sbp}/${telemetry.dbp} • SpO₂ ${telemetry.spo2}%</span>
          </div>
          <div class="card-summary-box">
            <strong>What's Happening:</strong> Your vitals, hydration, sleep, and radiation exposure are all inside safe mission limits.
          </div>
          <div class="risk-action-label">What To Do Now</div>
          <ul class="advisory-steps">
            <li><strong>Maintain current schedule:</strong> Continue your daily countermeasure workouts and hydration targets.</li>
            <li><strong>Log next shift telemetry:</strong> Re-check vitals at the end of your duty shift or prior to any EVA.</li>
          </ul>
        </div>
      `;
    }
  } else {
    if (physBadge) {
      physBadge.className = 'status-pill alert';
      physBadge.textContent = `${physEval.physicalFindings.length} ACTION ITEM(S)`;
    }
    if (physList) {
      physList.innerHTML = physEval.physicalFindings.map(item => `
        <div class="advisory-card alert-card">
          <div class="advisory-card-header">
            <h3 class="advisory-card-title">${item.title}</h3>
            <span class="advisory-card-meta">${item.reading}</span>
          </div>
          <div class="card-summary-box">
            <strong>What's Happening:</strong> ${item.summary}
          </div>
          <div class="risk-action-label">What To Do Now</div>
          <ul class="advisory-steps">
            ${item.steps.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }
  }

  const mentalBadge = document.getElementById('mentalAdvisoryBadge');
  const mentalList = document.getElementById('mentalAdvisoryList');
  const mentalCards = [];

  if (ghq.subscales.A >= 2) {
    mentalCards.push({
      title: 'Somatic Tension & Physical Fatigue Support',
      reading: `Subscale A Score: ${ghq.subscales.A} / 7`,
      summary: 'You reported physical run-down feelings, headaches, or bodily tension that often accompany high mission workload.',
      steps: [
        '<strong>Schedule a 20-minute guided body-scan relaxation:</strong> Release neck, shoulder, and jaw tension after duty shift.',
        '<strong>Verify hydration & magnesium intake:</strong> Low fluids and magnesium frequently worsen somatic headaches in orbit.'
      ]
    });
  }
  if (ghq.subscales.B >= 2) {
    mentalCards.push({
      title: 'Anxiety, Strain & Insomnia Countermeasures',
      reading: `Subscale B Score: ${ghq.subscales.B} / 7`,
      summary: 'Elevated worry, irritability, or broken sleep is reducing your mental recovery reserve.',
      steps: [
        '<strong>Practice 4-7-8 paced breathing before sleep:</strong> Lowers sympathetic nervous system arousal within 5 minutes.',
        '<strong>Use structured worry-offloading log:</strong> Write down next-day mission tasks 1 hour before sleep to clear working memory.'
      ]
    });
  }
  if (ghq.subscales.C >= 2) {
    mentalCards.push({
      title: 'Crew Cohesion & Decision-Load Support',
      reading: `Subscale C Score: ${ghq.subscales.C} / 7`,
      summary: 'You indicated reduced task satisfaction or hesitation in daily decision-making.',
      steps: [
        '<strong>Break complex checklists into 30-minute blocks:</strong> Focus on one sequential milestone at a time with crew cross-checks.',
        '<strong>Hold a brief crew peer debrief:</strong> Share workload priorities with your commander or crewmate.'
      ]
    });
  }
  if (ghq.subscales.D >= 1) {
    mentalCards.push({
      title: 'Priority Behavioral Health & Flight Surgeon Consultation',
      reading: `Subscale D Score: ${ghq.subscales.D} / 7`,
      summary: 'Your responses indicate low mood or hopelessness that warrants immediate private support.',
      steps: [
        '<strong>Initiate private Flight Surgeon / Behavioral Health link:</strong> Schedule a confidential 1-on-1 check-in immediately.',
        '<strong>Activate ground family & crew support connection:</strong> Arrange a private video/audio call with trusted ground support.'
      ]
    });
  }

  if (mentalCards.length === 0) {
    if (mentalBadge) {
      mentalBadge.className = 'status-pill normal';
      mentalBadge.textContent = 'RESILIENT BASELINE';
    }
    if (mentalList) {
      mentalList.innerHTML = `
        <div class="advisory-card">
          <div class="advisory-card-header">
            <h3 class="advisory-card-title">Psychological &amp; Cognitive Readiness Optimal</h3>
            <span class="advisory-card-meta">GHQ-28 Total: ${ghq.totalDistress}/28 • Mental Score ${ghq.mentalScore}%</span>
          </div>
          <div class="card-summary-box">
            <strong>What's Happening:</strong> Your somatic comfort, sleep resilience, social engagement, and mood are all within healthy baseline limits.
          </div>
          <div class="risk-action-label">What To Do Now</div>
          <ul class="advisory-steps">
            <li><strong>Keep routine crew social &amp; family contact:</strong> Maintain weekly ground calls and shared crew meals.</li>
            <li><strong>Re-screen weekly:</strong> Complete the GHQ-28 every 7–14 days to track long-duration adaptation.</li>
          </ul>
        </div>
      `;
    }
  } else {
    if (mentalBadge) {
      mentalBadge.className = 'status-pill alert';
      mentalBadge.textContent = `${mentalCards.length} SUPPORT PROTOCOL(S)`;
    }
    if (mentalList) {
      mentalList.innerHTML = mentalCards.map(card => `
        <div class="advisory-card alert-card">
          <div class="advisory-card-header">
            <h3 class="advisory-card-title">${card.title}</h3>
            <span class="advisory-card-meta">${card.reading}</span>
          </div>
          <div class="card-summary-box">
            <strong>What's Happening:</strong> ${card.summary}
          </div>
          <div class="risk-action-label">What To Do Now</div>
          <ul class="advisory-steps">
            ${card.steps.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }
  }

  const nasaBadge = document.getElementById('nasaRiskBadge');
  const nasaList = document.getElementById('nasaRiskAdvisoryList');
  const hasElevatedNasa = physEval.isAlert || physEval.nasaRisks.length > 1;
  if (nasaBadge) {
    nasaBadge.className = 'status-pill ' + (hasElevatedNasa ? 'alert' : 'normal');
    nasaBadge.textContent = hasElevatedNasa
      ? `${physEval.nasaRisks.length} ELEVATED RISK(S)`
      : 'BASELINE MONITORING';
  }
  if (nasaList) {
    nasaList.innerHTML = physEval.nasaRisks.map(risk => `
      <div class="advisory-card ${hasElevatedNasa ? 'alert-card' : ''}">
        <div class="advisory-card-header">
          <h3 class="advisory-card-title">${risk.title}</h3>
          <span class="advisory-card-meta">${risk.trigger}</span>
        </div>
        <div class="card-summary-box">
          <strong>What's Happening:</strong> ${risk.summary}
        </div>
        <div class="risk-action-label">How to Lower This Risk</div>
        <ul class="advisory-steps">
          ${risk.mitigation.map(m => `<li>${m}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }
}

// =========================================================
// 8. ADAPTIVE DIET & WORKOUT ENGINE
// =========================================================
function computeAdaptedRegimen(telemetry, ghq, envKey) {
  const envCfg = ENV_CONFIG[envKey] || ENV_CONFIG.space;
  const bio = calculateBiometrics(telemetry);

  let minKcal = Math.round(bio.bmr * envCfg.activityFactor);
  let minProtein = Math.round(telemetry.massKg * envCfg.proteinPerKg);
  let minFluids = Math.round(telemetry.massKg * envCfg.fluidPerKg);

  const reasons = [];
  let mode = 'nominal';

  const isMedicalStandDown =
    telemetry.temp >= 38.0 ||
    telemetry.sbp < envCfg.lowSbp ||
    telemetry.spo2 < envCfg.minSpo2 ||
    telemetry.hrRest > 100 ||
    telemetry.radRate > 0.50;

  if (isMedicalStandDown) {
    mode = 'critical';
    minFluids += telemetry.temp >= 38.0 || telemetry.sbp < envCfg.lowSbp ? 850 : 500;
    reasons.push(
      '<strong>Medical Stand-Down Active:</strong> Heavy treadmill and ARED resistance sessions are suspended due to acute vital or radiation alerts and replaced with a 20-minute Medical Rest & Light Mobility protocol.'
    );
    reasons.push(
      `<strong>Hydration Boost Applied:</strong> Minimum daily fluids increased to <strong>${minFluids.toLocaleString()} mL</strong> to support plasma volume and thermoregulation.`
    );
  }

  const needsCaloricSurplus =
    telemetry.massMo <= -2.0 ||
    telemetry.massTot <= -5.0 ||
    bio.bmi < 18.5 ||
    telemetry.kcal < minKcal * 0.85;

  if (needsCaloricSurplus) {
    if (mode === 'nominal') mode = 'caution';
    minKcal += 350;
    minProtein += 15;
    reasons.push(
      '<strong>+350 kcal &amp; +15 g Protein Surplus Active:</strong> Added across your 5 daily meal blocks to reverse body-mass loss and protect lean muscle tissue.'
    );
  }

  const isFatiguedOrDistressed =
    telemetry.sleepHrs < 6.0 ||
    telemetry.exLoad > 95 ||
    (ghq && ghq.totalDistress >= 6);

  if (isFatiguedOrDistressed && !isMedicalStandDown) {
    if (mode === 'nominal') mode = 'caution';
    reasons.push(
      '<strong>Recovery Intensity Scaling Active:</strong> Sleep deficit, high workload, or elevated GHQ-28 distress detected — cardio scaled to steady Zone 2 recovery and mobility/relaxation expanded to 25 min.'
    );
  }

  const isLowVo2 = telemetry.vo2Max < envCfg.minVo2;
  if (isLowVo2 && !isMedicalStandDown) {
    if (mode === 'nominal') mode = 'caution';
    reasons.push(
      `<strong>Aerobic Base Reconditioning Active:</strong> VO₂ max (${telemetry.vo2Max.toFixed(1)} mL/kg/min) is below the ${envCfg.minVo2} mission floor — Block 1 shifted to progressive aerobic intervals.`
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      '<strong>Nominal Performance Mode:</strong> All vitals, body mass, sleep, and mental readiness indicators support full gravity-calibrated nutrition and exercise targets.'
    );
  }

  const carbsGrams = Math.round((minKcal * 0.52) / 4);
  const fatGrams = Math.round((minKcal * 0.28) / 9);
  const zoneLow = Math.round(bio.maxHr * (isFatiguedOrDistressed ? 0.60 : 0.70));
  const zoneHigh = Math.round(bio.maxHr * (isFatiguedOrDistressed ? 0.68 : 0.78));

  const mealTemplates = [
    {
      name: 'Meal 1 • Breakfast (Wake +30 min)',
      kcalShare: 0.24, protShare: 0.24, fluidShare: 0.22,
      menu: envKey === 'space'
        ? 'Rehydrated scrambled eggs with spinach, fortified oat-berry pouch, and electrolyte citrus drink.'
        : 'High-protein oatmeal with walnuts, freeze-dried blueberries, fortified soy/dairy milk, and electrolyte water.',
      role: 'Restores overnight liver glycogen and provides Vitamin D₃ + calcium for morning bone metabolism.'
    },
    {
      name: 'Meal 2 • Mid-Morning Fuel',
      kcalShare: 0.14, protShare: 0.15, fluidShare: 0.18,
      menu: 'Almond-pumpkin seed energy bar, dried apricots, and potassium-rich electrolyte hydration pouch.',
      role: 'Sustains steady blood glucose and cognitive alertness during morning system operations.'
    },
    {
      name: 'Meal 3 • Lunch (Mid-Shift)',
      kcalShare: 0.26, protShare: 0.27, fluidShare: 0.24,
      menu: 'Thermostabilized grilled salmon or lentil-quinoa bowl, broccoli florets, brown rice, and herbal hydration drink.',
      role: 'Delivers omega-3 fatty acids, potassium, and complex carbohydrates ahead of afternoon exercise.'
    },
    {
      name: 'Meal 4 • Post-Workout Recovery',
      kcalShare: 0.14, protShare: 0.16, fluidShare: 0.20,
      menu: 'Whey/pea protein recovery shake with tart cherry concentrate and banana-oat bites.',
      role: 'Triggers muscle protein synthesis within 30 minutes of resistance loading and supplies radiation-fighting antioxidants.'
    },
    {
      name: 'Meal 5 • Dinner (Pre-Sleep -3 hrs)',
      kcalShare: 0.22, protShare: 0.18, fluidShare: 0.16,
      menu: 'Herb-roasted turkey or chickpea-tofu stew, sweet potato mash, steamed greens, and warm chamomile-magnesium infusion.',
      role: 'Supports overnight tissue repair and magnesium-assisted deep circadian sleep.'
    }
  ];

  const meals = mealTemplates.map(m => ({
    ...m,
    kcal: Math.round(minKcal * m.kcalShare),
    protein: Math.round(minProtein * m.protShare),
    carbs: Math.round(carbsGrams * m.kcalShare),
    fat: Math.round(fatGrams * m.kcalShare),
    water: Math.round(minFluids * m.fluidShare)
  }));

  let totalWorkoutMin = envCfg.targetExMin;
  let workouts = [];

  if (isMedicalStandDown) {
    totalWorkoutMin = 20;
    workouts = [
      {
        title: 'Block 1 • Medical Rest & Guided Breathing (10 min)',
        meta: 'SUPINE / SHELTERED • LOW EXERTION',
        summary: 'Strenuous cardio is paused while core temperature, blood pressure, oxygen saturation, or radiation levels stabilize.',
        steps: [
          '<strong>Perform 5 minutes of slow diaphragmatic breathing:</strong> 4-second inhale, 6-second exhale to stabilize heart rate and blood pressure.',
          '<strong>Stay inside shielded / climate-controlled module:</strong> Re-check vitals before resuming any upright load.'
        ]
      },
      {
        title: 'Block 2 • Gentle Range-of-Motion & Circulation (10 min)',
        meta: 'NO AXIAL LOADING • ZERO IMPACT',
        summary: 'Light joint circles prevent stiffness without raising core heat or cardiovascular demand.',
        steps: [
          '<strong>Ankle pumps & gentle calf squeezes (4 min):</strong> Promotes venous blood return without orthostatic strain.',
          '<strong>Seated neck, shoulder & wrist mobility (6 min):</strong> Slow pain-free movements only.'
        ]
      }
    ];
  } else {
    const cardioMin = envKey === 'space' ? 45 : envKey === 'moon' ? 40 : 35;
    const resistMin = envKey === 'space' ? 75 : envKey === 'moon' ? 55 : 40;
    const mobMin = isFatiguedOrDistressed ? 25 : 15;
    totalWorkoutMin = cardioMin + resistMin + mobMin;

    workouts = [
      {
        title: `Block 1 • Cardiopulmonary Conditioning (${cardioMin} min)`,
        meta: isFatiguedOrDistressed
          ? `ZONE 2 RECOVERY (${zoneLow}–${zoneHigh} BPM)`
          : isLowVo2
          ? `VO₂ RECONDITIONING INTERVALS (${zoneLow}–${Math.round(bio.maxHr * 0.84)} BPM)`
          : `AEROBIC TARGET (${zoneLow}–${zoneHigh} BPM)`,
        summary: isFatiguedOrDistressed
          ? 'Steady low-impact cycling or walking to promote blood flow without adding stress hormone fatigue.'
          : isLowVo2
          ? 'Structured 4-minute aerobic intervals to rebuild stroke volume and raise VO₂ max above mission floor.'
          : `Maintains heart muscle mass and vascular elasticity in ${envCfg.label}.`,
        steps: isFatiguedOrDistressed ? [
          `<strong>Steady CEVIS cycle or T2 walk (${cardioMin} min):</strong> Hold heart rate smoothly inside ${zoneLow}–${zoneHigh} bpm.`,
          '<strong>Hydrate continuously:</strong> Sip 250 mL electrolyte fluid every 20 minutes.'
        ] : [
          `<strong>Warm-up & steady aerobic base (${cardioMin - 15} min):</strong> Maintain ${zoneLow}–${zoneHigh} bpm on CEVIS ergometer or harness treadmill.`,
          '<strong>Threshold intervals (15 min):</strong> Alternate 3 min brisk effort with 2 min easy spin to preserve peak aerobic capacity.'
        ]
      },
      {
        title: `Block 2 • Resistive Bone & Muscle Loading (${resistMin} min)`,
        meta: `ARED / RESISTANCE • ${envCfg.gravity} COUNTERMEASURE`,
        summary: 'High-tension axial loading stimulates bone-forming osteoblasts in the hips, spine, and lower limbs.',
        steps: [
          '<strong>Lower-body axial lifts (4 sets × 8–10 reps):</strong> Squats, deadlifts, and single-leg heel raises at 75%–85% effort.',
          '<strong>Upper-body push/pull & core (3 sets × 10–12 reps):</strong> Bent-over rows, overhead press, and anti-rotation planks.'
        ]
      },
      {
        title: `Block 3 • Spinal Decompression, Balance & Mobility (${mobMin} min)`,
        meta: isFatiguedOrDistressed ? 'EXTENDED RECOVERY & VESTIBULAR RESET' : 'DAILY MOBILITY & SENSORIMOTOR',
        summary: 'Counters spinal elongation, hip-flexor tightness, and inner-ear balance adaptation.',
        steps: [
          '<strong>Thoracic & hip-flexor decompression (10 min):</strong> Controlled cat-cow, kneeling hip stretches, and hamstring release.',
          `<strong>Vestibular gaze & balance drills (${mobMin - 10} min):</strong> Single-leg stance with head turns to preserve planetary landing balance.`
        ]
      }
    ];
  }

  return {
    envCfg, bio, mode, reasons, minKcal, minProtein, carbsGrams, fatGrams,
    minFluids, zoneLow, zoneHigh, meals, totalWorkoutMin, workouts,
    isMedicalStandDown, needsCaloricSurplus
  };
}

function renderRegimenView() {
  const telemetry = cachedTelemetry;
  const ghq = cachedGhq;
  const emptyBox = document.getElementById('regimenEmptyState');
  const contentBox = document.getElementById('regimenContent');

  if (!telemetry) {
    if (contentBox) contentBox.style.display = 'none';
    if (emptyBox) {
      emptyBox.style.display = 'flex';
      emptyBox.innerHTML = renderEmptyStateHtml(
        'No Health Assessment Data Entered Yet',
        'Enter your age, gender, height, body mass, and vitals in Health Assessment first so AstrumCare can calculate your personalized calories, meals, and daily workout plan.',
        'Start Health Assessment',
        'assessment.html'
      );
    }
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (contentBox) contentBox.style.display = 'block';

  document.querySelectorAll('.regimen-env-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.env === selectedRegimenEnv);
  });

  const plan = computeAdaptedRegimen(telemetry, ghq, selectedRegimenEnv);

  const envBadge = document.getElementById('regimenEnvBadge');
  if (envBadge) {
    envBadge.innerHTML = `<span class="pulse-dot"></span> ${plan.envCfg.label.toUpperCase()} • ADAPTIVE PROTOCOL`;
  }

  const workloadTag = document.getElementById('regimenWorkloadTag');
  if (workloadTag) workloadTag.textContent = `Daily Exercise Target: ${plan.totalWorkoutMin} min/day`;

  const minimumsPill = document.getElementById('regimenMinimumsPill');
  if (minimumsPill) {
    minimumsPill.className = 'status-pill ' + (plan.needsCaloricSurplus ? 'alert' : 'normal');
    minimumsPill.textContent = plan.needsCaloricSurplus ? '+350 KCAL SURPLUS ACTIVE' : 'DAILY MINIMUM TARGETS';
  }

  const crewBanner = document.getElementById('regimenCrewBanner');
  if (crewBanner) {
    const genderLabel = telemetry.gender === 'female' ? 'Female' : 'Male';
    crewBanner.innerHTML = `
      <div class="summary-pill-item">
        <span class="summary-pill-label">Crew Profile</span>
        <span class="summary-pill-value">${telemetry.age} yrs • ${genderLabel} • ${telemetry.height} cm</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Body Mass &amp; BMI</span>
        <span class="summary-pill-value ${plan.bio.bmi < 18.5 ? 'warn' : 'ok'}">${telemetry.massKg} kg (BMI ${plan.bio.bmi})</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Resting Energy (BMR)</span>
        <span class="summary-pill-value">${plan.bio.bmr.toLocaleString()} kcal/day</span>
      </div>
      <div class="summary-pill-item">
        <span class="summary-pill-label">Target Workout HR</span>
        <span class="summary-pill-value">${plan.zoneLow}–${plan.zoneHigh} bpm (Max ${plan.bio.maxHr})</span>
      </div>
    `;
  }

  const overrideBanner = document.getElementById('regimenOverrideBanner');
  if (overrideBanner) {
    overrideBanner.className = 'regimen-override-banner ' + (plan.mode === 'nominal' ? '' : plan.mode);
    const modeTitle = plan.mode === 'critical'
      ? 'MEDICAL STAND-DOWN OVERRIDE ACTIVE'
      : plan.mode === 'caution'
      ? 'ADAPTIVE RECOVERY & FUELING ADJUSTMENT ACTIVE'
      : 'NOMINAL PERFORMANCE REGIMEN ACTIVE';

    overrideBanner.innerHTML = `
      <div class="override-header-row">
        <span>${modeTitle}</span>
        <div class="override-tags">
          <span class="override-tag">${plan.envCfg.label}</span>
          <span class="override-tag">${plan.minKcal.toLocaleString()} kcal/day</span>
          <span class="override-tag">${plan.totalWorkoutMin} min workout</span>
        </div>
      </div>
      <ul class="override-list">
        ${plan.reasons.map(r => `<li>${r}</li>`).join('')}
      </ul>
    `;
  }

  const nutrientGrid = document.getElementById('nutrientSummaryGrid');
  if (nutrientGrid) {
    nutrientGrid.innerHTML = `
      <div class="nutrient-box">
        <span class="nutrient-label">Minimum Daily Calories</span>
        <span class="nutrient-value">${plan.minKcal.toLocaleString()} kcal</span>
        <span class="nutrient-sub">${plan.needsCaloricSurplus ? 'Includes +350 kcal recovery surplus' : `BMR × ${plan.envCfg.activityFactor} (${plan.envCfg.gravity})`}</span>
      </div>
      <div class="nutrient-box">
        <span class="nutrient-label">Daily Protein Target</span>
        <span class="nutrient-value">${plan.minProtein} g</span>
        <span class="nutrient-sub">${plan.envCfg.proteinPerKg} g/kg lean-mass protection</span>
      </div>
      <div class="nutrient-box">
        <span class="nutrient-label">Carbs &amp; Healthy Fats</span>
        <span class="nutrient-value">${plan.carbsGrams}g C / ${plan.fatGrams}g F</span>
        <span class="nutrient-sub">52% complex carbs • 28% unsaturated fats</span>
      </div>
      <div class="nutrient-box">
        <span class="nutrient-label">Minimum Daily Fluids</span>
        <span class="nutrient-value">${plan.minFluids.toLocaleString()} mL</span>
        <span class="nutrient-sub">${plan.isMedicalStandDown ? 'Includes medical hydration boost' : `${plan.envCfg.fluidPerKg} mL/kg baseline`}</span>
      </div>
    `;
  }

  const magCell = document.getElementById('magnesiumTargetCell');
  const ironCell = document.getElementById('ironTargetCell');
  if (magCell) magCell.textContent = telemetry.gender === 'female' ? '310 – 320 mg' : '400 – 420 mg';
  if (ironCell) {
    const ironTarget = telemetry.gender === 'female' && telemetry.age <= 50 ? '15 – 18 mg Fe' : '8 – 10 mg Fe';
    ironCell.textContent = `< 2,300 mg Na / ${ironTarget}`;
  }

  const mealList = document.getElementById('mealPlanList');
  if (mealList) {
    mealList.innerHTML = plan.meals.map(meal => `
      <div class="advisory-card">
        <div class="advisory-card-header">
          <h3 class="advisory-card-title">${meal.name}</h3>
          <div class="macro-pill-row">
            <span class="macro-pill gold">${meal.kcal} kcal</span>
            <span class="macro-pill">${meal.protein}g Protein</span>
            <span class="macro-pill">${meal.carbs}g Carbs</span>
            <span class="macro-pill">${meal.fat}g Fat</span>
            <span class="macro-pill">${meal.water} mL Water</span>
          </div>
        </div>
        <div class="card-summary-box">
          <strong>Menu:</strong> ${meal.menu}
        </div>
        <p style="font-size: 0.86rem; color: var(--text-secondary); line-height: 1.55;">
          <strong style="color: var(--text-primary);">Mission Role:</strong> ${meal.role}
        </p>
      </div>
    `).join('');
  }

  const workoutBadge = document.getElementById('workoutTotalBadge');
  if (workoutBadge) {
    workoutBadge.className = 'status-pill ' + (plan.isMedicalStandDown ? 'alert' : 'normal');
    workoutBadge.textContent = `${plan.totalWorkoutMin} MIN / DAY`;
  }

  const workoutList = document.getElementById('workoutRoutineList');
  if (workoutList) {
    workoutList.innerHTML = plan.workouts.map(w => `
      <div class="advisory-card ${plan.isMedicalStandDown ? 'alert-card' : ''}">
        <div class="advisory-card-header">
          <h3 class="advisory-card-title">${w.title}</h3>
          <span class="advisory-card-meta">${w.meta}</span>
        </div>
        <div class="card-summary-box">
          <strong>Focus:</strong> ${w.summary}
        </div>
        <div class="risk-action-label">Execution Steps</div>
        <ul class="advisory-steps">
          ${w.steps.map(s => `<li>${s}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }
}

// =========================================================
// 9. MISSION HUB HUD PILLS
// =========================================================
function updateHomeHud() {
  const telemetry = cachedTelemetry;
  const hrPill = document.getElementById('hud-hr-pill');
  const bpPill = document.getElementById('hud-bp-pill');
  const tempPill = document.getElementById('hud-temp-pill');
  const spo2Pill = document.getElementById('hud-spo2-pill');

  if (!telemetry) {
    if (hrPill) {
      hrPill.className = 'hud-pill pill-top-left standby';
      document.getElementById('hud-hr-val').textContent = '-- bpm';
      hrPill.querySelector('.hud-status').textContent = 'AWAITING';
    }
    if (bpPill) {
      bpPill.className = 'hud-pill pill-top-right standby';
      document.getElementById('hud-bp-val').textContent = '--/-- mmHg';
      bpPill.querySelector('.hud-status').textContent = 'AWAITING';
    }
    if (tempPill) {
      tempPill.className = 'hud-pill pill-bottom-left standby';
      document.getElementById('hud-temp-val').textContent = '-- °C';
      tempPill.querySelector('.hud-status').textContent = 'AWAITING';
    }
    if (spo2Pill) {
      spo2Pill.className = 'hud-pill pill-bottom-right standby';
      document.getElementById('hud-spo2-val').textContent = '-- %';
      spo2Pill.querySelector('.hud-status').textContent = 'AWAITING';
    }
    return;
  }

  const envCfg = ENV_CONFIG[telemetry.env] || ENV_CONFIG.space;

  const hrAlert = telemetry.hrRest > 100 || telemetry.hrRest < 45;
  if (hrPill) {
    hrPill.className = 'hud-pill pill-top-left' + (hrAlert ? ' alert' : '');
    document.getElementById('hud-hr-val').textContent = `${telemetry.hrRest} bpm`;
    hrPill.querySelector('.hud-status').textContent = hrAlert ? 'ALERT' : 'NORMAL';
  }

  const bpAlert = telemetry.sbp < envCfg.lowSbp || telemetry.dbp < 60 || telemetry.sbp >= 140 || telemetry.dbp >= 90;
  if (bpPill) {
    bpPill.className = 'hud-pill pill-top-right' + (bpAlert ? ' alert' : '');
    document.getElementById('hud-bp-val').textContent = `${telemetry.sbp}/${telemetry.dbp} mmHg`;
    bpPill.querySelector('.hud-status').textContent = bpAlert ? 'ALERT' : 'NORMAL';
  }

  const tempAlert = telemetry.temp >= 38.0 || telemetry.temp < 36.0;
  if (tempPill) {
    tempPill.className = 'hud-pill pill-bottom-left' + (tempAlert ? ' alert' : '');
    document.getElementById('hud-temp-val').textContent = `${telemetry.temp.toFixed(1)} °C`;
    tempPill.querySelector('.hud-status').textContent = tempAlert ? 'ALERT' : 'NORMAL';
  }

  const spo2Alert = telemetry.spo2 < envCfg.minSpo2;
  if (spo2Pill) {
    spo2Pill.className = 'hud-pill pill-bottom-right' + (spo2Alert ? ' alert' : '');
    document.getElementById('hud-spo2-val').textContent = `${telemetry.spo2} %`;
    spo2Pill.querySelector('.hud-status').textContent = spo2Alert ? 'ALERT' : 'NORMAL';
  }
}

// =========================================================
// 10. PAGE BOOTSTRAPPER (ASYNC SQLITE HYDRATION)
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  initStarfield();
  const page = document.body.dataset.page || 'home';
  const currentUser = enforceRouteAccess(page);

  if (page === 'login') {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const errBox = document.getElementById('loginErrorNotice');

        try {
          const user = await authenticateUser(username, password);
          if (!user) {
            errBox.textContent = 'Access Denied: Invalid crew username or passcode.';
            errBox.style.display = 'block';
            return;
          }
          window.location.href = 'index.html';
        } catch (err) {
          errBox.textContent = 'Connection Error: Unable to reach AstrumCare mission database.';
          errBox.style.display = 'block';
        }
      });
    }
    return;
  }

  if (!currentUser) return;
  injectNavAuthControls(currentUser, page);

  if (page === 'admin') {
    await renderAdminRosterTable(currentUser);

    const addUserForm = document.getElementById('addUserForm');
    const notice = document.getElementById('adminFeedbackNotice');
    if (addUserForm) {
      addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('new-user-fullname').value.trim();
        const username = document.getElementById('new-user-username').value.trim().toLowerCase();
        const password = document.getElementById('new-user-password').value;
        const role = document.getElementById('new-user-role').value;

        try {
          const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, fullName, role })
          });
          const data = await res.json();

          if (!res.ok) {
            notice.className = 'inline-notice';
            notice.textContent = data.error || `Unable to provision account "${username}".`;
            notice.style.display = 'block';
            return;
          }

          addUserForm.reset();
          notice.className = 'inline-notice success';
          notice.textContent = `Crew account "${username}" (${role.toUpperCase()}) provisioned in SQLite database.`;
          notice.style.display = 'block';
          await renderAdminRosterTable(currentUser);
        } catch (err) {
          notice.className = 'inline-notice';
          notice.textContent = 'Server error while creating crew account.';
          notice.style.display = 'block';
        }
      });
    }
    return;
  }

  await loadUserAssessmentState(currentUser.username);

  if (page === 'home') {
    updateHomeHud();
  } else if (page === 'assessment') {
    if (cachedTelemetry) {
      selectedAssessmentEnv = cachedTelemetry.env || 'space';
      document.querySelectorAll('.env-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.env === selectedAssessmentEnv);
      });
      populateAssessmentFields(cachedTelemetry, false);
    }

    document.querySelectorAll('.env-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedAssessmentEnv = btn.dataset.env;
        document.querySelectorAll('.env-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => applyAssessmentPreset(btn.dataset.preset, currentUser.username));
    });

    const assessmentForm = document.getElementById('assessmentForm');
    if (assessmentForm) {
      assessmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const telemetryPayload = {
          env: selectedAssessmentEnv,
          age: Number(document.getElementById('in-age').value),
          gender: document.getElementById('in-gender').value,
          height: Number(document.getElementById('in-height').value),
          massKg: Number(document.getElementById('in-mass-kg').value),
          massMo: Number(document.getElementById('in-mass-mo').value),
          massTot: Number(document.getElementById('in-mass-tot').value),
          hrRest: Number(document.getElementById('in-hr-rest').value),
          hrEx: Number(document.getElementById('in-hr-ex').value),
          sbp: Number(document.getElementById('in-sbp').value),
          dbp: Number(document.getElementById('in-dbp').value),
          temp: Number(document.getElementById('in-temp').value),
          rr: Number(document.getElementById('in-rr').value),
          spo2: Number(document.getElementById('in-spo2').value),
          sleepHrs: Number(document.getElementById('in-sleep-hrs').value),
          sleepQual: Number(document.getElementById('in-sleep-qual').value),
          exMin: Number(document.getElementById('in-ex-min').value),
          exLoad: Number(document.getElementById('in-ex-load').value),
          kcal: Number(document.getElementById('in-kcal').value),
          protein: Number(document.getElementById('in-protein').value),
          fluids: Number(document.getElementById('in-fluids').value),
          radRate: Number(document.getElementById('in-rad-rate').value),
          radCum: Number(document.getElementById('in-rad-cum').value),
          vo2Max: Number(document.getElementById('in-vo2-max').value)
        };

        await saveUserTelemetry(currentUser.username, telemetryPayload);
        window.location.href = 'questionnaire.html';
      });
    }
  } else if (page === 'questionnaire') {
    buildGhq28Questionnaire();

    const btnOpt = document.getElementById('ghqFillOptimal');
    const btnNorm = document.getElementById('ghqFillNormal');
    const btnDist = document.getElementById('ghqFillDistress');
    if (btnOpt) btnOpt.addEventListener('click', () => fillGhqDemo('optimal'));
    if (btnNorm) btnNorm.addEventListener('click', () => fillGhqDemo('normal'));
    if (btnDist) btnDist.addEventListener('click', () => fillGhqDemo('distress'));

    const ghqForm = document.getElementById('ghq28Form');
    if (ghqForm) {
      ghqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const responses = [];
        let firstMissingIdx = -1;

        for (let i = 0; i < 28; i++) {
          const checked = ghqForm.querySelector(`input[name="ghq_q_${i}"]:checked`);
          const itemEl = document.getElementById(`ghq-item-${i}`);
          if (!checked) {
            if (firstMissingIdx === -1) firstMissingIdx = i;
            if (itemEl) itemEl.classList.add('missing-highlight');
          } else {
            if (itemEl) itemEl.classList.remove('missing-highlight');
            responses.push(Number(checked.value));
          }
        }

        const notice = document.getElementById('ghqValidationNotice');
        if (firstMissingIdx !== -1) {
          if (notice) {
            notice.textContent = `Please answer all 28 questions before continuing (Question ${firstMissingIdx + 1} is unanswered).`;
            notice.style.display = 'block';
          }
          const missingEl = document.getElementById(`ghq-item-${firstMissingIdx}`);
          if (missingEl) missingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        if (notice) notice.style.display = 'none';
        const ghqResult = scoreGhq28Responses(responses);
        await saveUserGhq(currentUser.username, ghqResult);
        window.location.href = 'results.html';
      });
    }
  } else if (page === 'results') {
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedTrendDays = Number(btn.dataset.days);
        renderLongitudinalTrends();
      });
    });

    document.querySelectorAll('.metric-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedTrendMetric = btn.dataset.metric;
        renderLongitudinalTrends();
      });
    });

    const toggleLogBtn = document.getElementById('toggleLogTableBtn');
    const logWrap = document.getElementById('telemetryHistoryTableWrap');
    if (toggleLogBtn && logWrap) {
      toggleLogBtn.addEventListener('click', () => {
        const isHidden = logWrap.style.display === 'none';
        logWrap.style.display = isHidden ? 'block' : 'none';
        toggleLogBtn.textContent = isHidden ? 'Hide Dated Telemetry Log Table' : 'Show Dated Telemetry Log Table';
      });
    }

    renderResultsView();
  } else if (page === 'advisory') {
    renderAdvisoryView();
  } else if (page === 'regimen') {
    if (cachedTelemetry && cachedTelemetry.env) selectedRegimenEnv = cachedTelemetry.env;

    document.querySelectorAll('.regimen-env-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRegimenEnv = btn.dataset.env;
        renderRegimenView();
      });
    });

    renderRegimenView();
  }
});
