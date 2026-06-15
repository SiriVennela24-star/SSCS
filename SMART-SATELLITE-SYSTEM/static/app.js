import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log("=== SATELLITE APP SCRIPT LOADED ===");

// --- GLOBAL VARIABLES & DATA STORES ---
let renderer, scene, camera, controls;
let earthGroup, earth, clouds, atmosphere, solidEarth;
let gsGroup, pingRing, groundStation;
let ws = null;
let simulationStarted = false;
let lastSnr = 35.0;

const textureLoader = new THREE.TextureLoader();
const packetGeo = new THREE.SphereGeometry(0.035, 8, 8);
const gltfLoader = new GLTFLoader();

const gsLat = 12.9716;
const gsLon = 77.5946;

const satellitesInfo = {};
const beamsInfo = {};
const packetsInfo = {};

const matColors = {
    normal: new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
    anomaly: new THREE.LineBasicMaterial({ color: 0xff003c, transparent: true, opacity: 0.8, linewidth: 2, blending: THREE.AdditiveBlending }),
    quantum: new THREE.LineBasicMaterial({ color: 0xcc00ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending })
};

// Two-Line Element (TLE) datasets representing real satellites
const satelliteTLEs = {
    "SAT-1": {
        name: "ISS (ZARYA)",
        line1: "1 25544U 98067A   26150.52554271  .00016717  00000-0  31671-3 0  9998",
        line2: "2 25544  51.6418  24.3853 0006190  89.1763  31.5432 15.49832717571239"
    },
    "SAT-2": {
        name: "HST (HUBBLE)",
        line1: "1 20580U 90037B   26150.45627192  .00000842  00000-0  56281-4 0  9993",
        line2: "2 20580  28.4682 143.2389 0002847 241.1683 118.7329 14.99281729 33281"
    },
    "SAT-3": {
        name: "NOAA 19",
        line1: "1 33591U 09005A   26150.51829371  .00000084  00000-0  73841-4 0  9991",
        line2: "2 33591  99.1628  87.2341 0013928 214.3912 145.6983 14.12873918882736"
    },
    "SAT-4": {
        name: "STARLINK-1007",
        line1: "1 44713U 19074A   26150.53127839  .00001592  00000-0  12481-3 0  9995",
        line2: "2 44713  53.0543 287.1682 0001428 112.4391 247.7381 15.06847192348912"
    },
    "SAT-5": {
        name: "STARLINK-1008",
        line1: "1 44714U 19074B   26150.52481927  .00001482  00000-0  11821-3 0  9992",
        line2: "2 44714  53.0541 287.4812 0001435 112.1824 247.9821 15.06894721348216"
    },
    "SAT-6": {
        name: "TIANGONG (CSS)",
        line1: "1 48274U 21035A   26150.52187392  .00011847  00000-0  21641-3 0  9994",
        line2: "2 48274  41.4728 318.4912 0008412  78.2912 281.8491 15.59281749281938"
    },
    "SAT-7": {
        name: "ENVISAT",
        line1: "1 27386U 02009A   26150.49321873  .00000012  00000-0  10281-4 0  9996",
        line2: "2 27386  98.5412 195.3482 0001248  94.2812 265.8491 14.38291873261947"
    }
};

const satrecs = {};
for (const id in satelliteTLEs) {
    satrecs[id] = satellite.twoline2satrec(satelliteTLEs[id].line1, satelliteTLEs[id].line2);
}

// Convert Geodetic (Lat, Lon, Alt) to 3D Vector coordinates
function latLonToVector3(lat, lon, altKm) {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = -(lon * Math.PI) / 180; // Negate to match Three.js texture mapping orientation
    const earthRadius3D = 4.0;
    const altScale = 4.0 / 6371.0;
    const r = earthRadius3D + (altKm * altScale);

    return new THREE.Vector3(
        r * Math.cos(latRad) * Math.cos(lonRad),
        r * Math.sin(latRad),
        r * Math.cos(latRad) * Math.sin(lonRad)
    );
}

// Programmatic satellite mesh construction
function createSatelliteMesh() {
    const group = new THREE.Group();

    // Gold foil hexagonal body
    const bodyGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.35, 6);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // gold
        metalness: 0.9,
        roughness: 0.1
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    // Solar panel materials
    const panelMat = new THREE.MeshStandardMaterial({
        color: 0x0f2a4a,
        emissive: 0x051025,
        metalness: 0.8,
        roughness: 0.2
    });
    const structuralMat = new THREE.MeshStandardMaterial({
        color: 0x555555,
        metalness: 0.9,
        roughness: 0.3
    });

    // Booms/Booster rods
    const boomGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8);
    const boom = new THREE.Mesh(boomGeo, structuralMat);
    boom.rotation.z = Math.PI / 2;
    group.add(boom);

    // Left & Right Solar Panels
    const panelGeo = new THREE.BoxGeometry(0.5, 0.015, 0.22);
    const leftPanel = new THREE.Mesh(panelGeo, panelMat);
    leftPanel.position.set(-0.5, 0, 0);
    group.add(leftPanel);

    const rightPanel = new THREE.Mesh(panelGeo, panelMat);
    rightPanel.position.set(0.5, 0, 0);
    group.add(rightPanel);

    // Parabolic communications dish pointing to Earth
    const dishGeo = new THREE.ConeGeometry(0.09, 0.12, 16, 1, true);
    const dishMat = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 0.8,
        roughness: 0.2,
        side: THREE.DoubleSide
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(0, 0, 0.18);
    dish.rotation.x = Math.PI / 2;
    group.add(dish);

    // Antenna feed horn
    const feedGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8);
    const feed = new THREE.Mesh(feedGeo, structuralMat);
    feed.position.set(0, 0, 0.24);
    feed.rotation.x = Math.PI / 2;
    group.add(feed);

    return group;
}

// --- DOM ELEMENTS CONTROLS ---
const satelliteProfileSelect = document.getElementById('satellite-profile');
const noiseSlider = document.getElementById('noise-slider');
const timeSlider = document.getElementById('time-slider');
const aiToggle = document.getElementById('ai-toggle');
const quantumToggle = document.getElementById('quantum-toggle');
const quantumShotsInput = document.getElementById('quantum-shots');
const jammingToggle = document.getElementById('jamming-toggle');
const eavesdroppingToggle = document.getElementById('eavesdropping-toggle');
const encStatus = document.getElementById('enc-status');
const viewHistoryBtn = document.getElementById('view-history-btn');
const statusInd = document.getElementById('status-indicator');

const waveCanvas = document.getElementById('waveform-canvas');
const waveCtx = waveCanvas.getContext('2d');

const simState = {
    time: 0,
    time_scale: 1.0,
    noiseLevel: 0.1,
    aiEnabled: false,
    quantumEnabled: false,
    satellites: [],
    waveform: [],
    anomaly: false,
    quantum_key: "",
    qber: 0.0,
    satellite_id: "starlink",
    current_frequency: 12000.0,
    rf: { carrier: 12000.0, uplink: 13800.0, downlink: 11400.0, snr: 35.0 },
    fileUploadedMode: false,
    fileAnomalyActive: false
};

// --- CHART.JS METRIC VISUALIZATIONS ---
const ctxA = document.getElementById('chart-snr-loss').getContext('2d');
const chartA = new Chart(ctxA, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'SNR (dB)',
                data: [],
                borderColor: '#00f3ff',
                backgroundColor: 'rgba(0, 243, 255, 0.1)',
                borderWidth: 2,
                yAxisID: 'y-snr',
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: 'Packet Loss (%)',
                data: [],
                borderColor: '#ff003c',
                backgroundColor: 'rgba(255, 0, 60, 0.1)',
                borderWidth: 2,
                yAxisID: 'y-loss',
                tension: 0.3,
                pointRadius: 0
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#888', font: { size: 9 } }
            },
            'y-snr': {
                type: 'linear',
                position: 'left',
                min: -10,
                max: 55,
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#00f3ff', font: { size: 9 } }
            },
            'y-loss': {
                type: 'linear',
                position: 'right',
                min: 0,
                max: 100,
                grid: { drawOnChartArea: false },
                ticks: { color: '#ff003c', font: { size: 9 } }
            }
        },
        plugins: {
            legend: {
                labels: { color: '#ccc', font: { size: 8 } },
                boxWidth: 8
            }
        }
    }
});

const ctxB = document.getElementById('chart-throughput').getContext('2d');
const chartB = new Chart(ctxB, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Uplink (Mbps)',
                data: [],
                borderColor: '#00ff66',
                backgroundColor: 'rgba(0, 255, 102, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: 'Downlink (Mbps)',
                data: [],
                borderColor: '#cc00ff',
                backgroundColor: 'rgba(204, 0, 255, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 0
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#888', font: { size: 9 } }
            },
            y: {
                min: 0,
                max: 250,
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#ccc', font: { size: 9 } }
            }
        },
        plugins: {
            legend: {
                labels: { color: '#ccc', font: { size: 8 } },
                boxWidth: 8
            }
        }
    }
});

// Throttled Chart Update (runs at 1 Hz)
window.setInterval(() => {
    if (!simulationStarted) return;
    if (simState.fileUploadedMode) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const loss = Math.max(0, Math.min(100, Math.round(100 - (lastSnr * 2.5))));
    const snrRatio = Math.max(0, Math.min(1, (lastSnr + 5) / 55));
    const downlinkSpeed = Math.round(200 * snrRatio + (Math.random() * 8 - 4));
    const uplinkSpeed = Math.round(75 * snrRatio + (Math.random() * 4 - 2));

    // Update Chart A
    chartA.data.labels.push(timeStr);
    chartA.data.datasets[0].data.push(lastSnr);
    chartA.data.datasets[1].data.push(loss);
    if (chartA.data.labels.length > 30) {
        chartA.data.labels.shift();
        chartA.data.datasets[0].data.shift();
        chartA.data.datasets[1].data.shift();
    }
    chartA.update('none');

    // Update Chart B
    chartB.data.labels.push(timeStr);
    chartB.data.datasets[0].data.push(Math.max(0, uplinkSpeed));
    chartB.data.datasets[1].data.push(Math.max(0, downlinkSpeed));
    if (chartB.data.labels.length > 30) {
        chartB.data.labels.shift();
        chartB.data.datasets[0].data.shift();
        chartB.data.datasets[1].data.shift();
    }
    chartB.update('none');
}, 1000);

// --- 2D OSCILLOSCOPE DRAWING (REPLACED BY ANIMATION LOOP) ---
function drawOscilloscope(data) {
    // No-op: replaced by continuous requestAnimationFrame loop
}

let oscPhase = 0;
function animateOscilloscope() {
    requestAnimationFrame(animateOscilloscope);

    waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);

    // Draw grid lines
    waveCtx.strokeStyle = 'rgba(0, 243, 255, 0.08)';
    waveCtx.lineWidth = 1;
    waveCtx.shadowBlur = 0;
    for (let i = 0; i < waveCanvas.width; i += 20) {
        waveCtx.beginPath();
        waveCtx.moveTo(i, 0);
        waveCtx.lineTo(i, waveCanvas.height);
        waveCtx.stroke();
    }
    for (let i = 0; i < waveCanvas.height; i += 20) {
        waveCtx.beginPath();
        waveCtx.moveTo(0, i);
        waveCtx.lineTo(waveCanvas.width, i);
        waveCtx.stroke();
    }

    // Phase speed is controlled by Simulation Speed slider (time_scale)
    const speed = simState.time_scale || 1.0;
    oscPhase += 0.05 * speed;

    // Draw wave
    waveCtx.beginPath();
    const isAnomaly = simState.anomaly || simState.fileAnomalyActive;
    waveCtx.strokeStyle = isAnomaly ? 'var(--neon-red)' : 'var(--neon-blue)';
    waveCtx.lineWidth = 2;
    waveCtx.shadowBlur = 6;
    waveCtx.shadowColor = isAnomaly ? 'var(--neon-red)' : 'var(--neon-blue)';

    const width = waveCanvas.width;
    const height = waveCanvas.height;
    const centerY = height / 2;
    const noiseVal = simState.noiseLevel !== undefined ? simState.noiseLevel : 0.1;

    // Base amplitude
    const baseAmp = height / 4;

    for (let x = 0; x < width; x++) {
        // Base sine wave with frequency dependent on satellite profile
        let freqScale = 0.05;
        if (simState.satellite_id === 'noaa') freqScale = 0.02;
        else if (simState.satellite_id === 'gps') freqScale = 0.04;
        else freqScale = 0.08;

        const sine = Math.sin(x * freqScale - oscPhase);

        // Noise roughness scales with the Atmospheric Noise Level slider
        const roughness = (Math.random() - 0.5) * baseAmp * noiseVal * 1.5;

        const y = centerY + sine * baseAmp + roughness;

        if (x === 0) {
            waveCtx.moveTo(x, y);
        } else {
            waveCtx.lineTo(x, y);
        }
    }

    waveCtx.stroke();
    waveCtx.shadowBlur = 0;
}

// --- DYNAMIC 3D BEAMS CONFIGURATION ---
function getProfileConfig(satId) {
    if (satId === 'noaa') {
        return { color: 0xff3333, speed: 0.005, particleCount: 2 };
    } else if (satId === 'gps') {
        return { color: 0xffaa00, speed: 0.012, particleCount: 4 };
    } else { // starlink
        return { color: 0xcc00ff, speed: 0.025, particleCount: 6 };
    }
}

// --- UI DASHBOARD UPDATES ---
function updateDashboard(state) {
    if (state.rf) {
        lastSnr = state.rf.snr;
        document.getElementById('carrier-freq').textContent = state.rf.carrier.toFixed(2);
        document.getElementById('uplink-freq').textContent = state.rf.uplink.toFixed(2);
        document.getElementById('downlink-freq').textContent = state.rf.downlink.toFixed(2);
    }

    const aiBox = document.getElementById('ai-alerts-box');
    if (state.anomaly) {
        aiBox.className = "box alarm";
        aiBox.innerHTML = `ALARM_ID: 1xAF90<br>WARNING: UNEXPECTED SIGNAL INTRUSION<br>CONFIDENCE: ${(Math.random() * 10 + 85).toFixed(1)}%`;
    } else if (state.predictive_score > 50) {
        aiBox.className = "box warning";
        aiBox.innerHTML = `PREDICTIVE ALERT<br>SIGNAL DEGRADATION IMMINENT<br>NOISE VARIANCE: ${state.predictive_score}%`;
    } else {
        aiBox.className = "box clear";
        aiBox.textContent = "NO ANOMALIES DETECTED. SYSTEM STABLE.";
    }

    // AI Logging Console
    if (state.ai_enabled || state.jamming_enabled) {
        let msg = null;
        if (state.jamming_enabled && Math.random() > 0.8) {
            msg = "[CRITICAL] JAMMING ATTACK DETECTED. APPLYING COUNTERMEASURES...";
        } else if (state.predictive_score > 80 && Math.random() > 0.7) {
            msg = `[WARNING] PREDICTING COMMS FAILURE. NOISE VARIANCE CRITICAL (${state.predictive_score}%)...`;
        } else if (state.predictive_score > 50 && Math.random() > 0.9) {
            msg = `[INFO] ANALYZING INCREASED NOISE PATTERNS. SYSTEM STABLE (${state.predictive_score}%).`;
        } else if (state.ai_enabled && Math.random() > 0.98) {
            msg = `[SYSTEM] CONTINUAL VULNERABILITY SCAN NOMINAL.`;
        }

        if (msg) {
            const jarvisLog = document.getElementById('jarvis-log');
            if (jarvisLog.textContent === "AWAITING SYSTEM INITIALIZATION...") jarvisLog.innerHTML = "";
            const p = document.createElement('p');
            p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            jarvisLog.prepend(p);
            if (jarvisLog.children.length > 8) jarvisLog.removeChild(jarvisLog.lastChild);
        }
    }

    const qkBox = document.getElementById('qk-box');
    if (state.quantum_key) {
        qkBox.className = "box";
        qkBox.style.borderColor = "var(--neon-purple)";
        qkBox.style.boxShadow = "inset 0 0 10px rgba(204,0,255,0.2)";

        let qkdText = `KEY: ${state.quantum_key.substring(0, 16)}...<br>QBER: ${(state.qber * 100).toFixed(1)}%`;
        if (state.eavesdropping_enabled) {
            qkdText += `<br><span style="color: var(--neon-red); font-weight: bold; animation: flash 1s infinite;">BREACH DETECTED</span>`;
        } else {
            qkdText += `<br><span style="color: var(--neon-green); font-weight: bold;">SECURE CHANNEL</span>`;
        }
        qkBox.innerHTML = qkdText;
    } else {
        qkBox.className = "box qk-idle";
        qkBox.textContent = "SYSTEM DEACTIVATED. AWAITING ACTIVATION.";
        qkBox.style.borderColor = "#444";
        qkBox.style.boxShadow = "none";
    }

    // Canvas oscilloscope drawing
    if (state.waveform && Array.isArray(state.waveform)) {
        drawOscilloscope(state.waveform);
    }
}

// --- THREE JS INITIALIZATION ---
function initThreeJS() {
    console.log("initThreeJS: Starting...");
    ws = new WebSocket("wss://sscs-bh9j.onrender.com/ws");
    const canvas = document.getElementById('canvas3d');
    console.log("initThreeJS: Canvas element:", canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    console.log("initThreeJS: WebGLRenderer created");
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020205);
    scene.fog = new THREE.FogExp2(0x020205, 0.015);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 25);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;

    // Lighting
    scene.add(new THREE.AmbientLight(0x334455, 1.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(15, 10, 15);
    scene.add(dirLight);

    const blueLight = new THREE.PointLight(0x00f3ff, 2.5, 50);
    blueLight.position.set(-15, -10, -15);
    scene.add(blueLight);

    // Earth and atmosphere structures
    earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // Earth mesh
    const earthGeo = new THREE.SphereGeometry(4, 64, 64);
    const earthMat = new THREE.MeshPhongMaterial({
        map: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'),
        bumpMap: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg'),
        bumpScale: 0.15,
        specularMap: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg'),
        specular: new THREE.Color('grey'),
        shininess: 25
    });
    earth = new THREE.Mesh(earthGeo, earthMat);
    earthGroup.add(earth);

    // Clouds
    const cloudGeo = new THREE.SphereGeometry(4.06, 64, 64);
    const cloudMat = new THREE.MeshPhongMaterial({
        map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png'),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });
    clouds = new THREE.Mesh(cloudGeo, cloudMat);
    earthGroup.add(clouds);

    // Atmospheric Glow Shader
    const atmosGeo = new THREE.SphereGeometry(4.35, 64, 64);
    const atmosMat = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
                gl_FragColor = vec4(0.0, 0.95, 1.0, 1.0) * intensity;
            }
        `,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false
    });
    atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    earthGroup.add(atmosphere);

    // Inner core backing
    solidEarth = new THREE.Mesh(
        new THREE.SphereGeometry(3.9, 32, 32),
        new THREE.MeshLambertMaterial({ color: 0x000511 })
    );
    earthGroup.add(solidEarth);

    // Bangalore Ground Station placement
    gsGroup = new THREE.Group();
    earthGroup.add(gsGroup);
    const gsPos = latLonToVector3(gsLat, gsLon, 0);
    gsGroup.position.copy(gsPos);
    const gsNormal = gsPos.clone().normalize();
    const upVec = new THREE.Vector3(0, 1, 0);
    const gsQuaternion = new THREE.Quaternion().setFromUnitVectors(upVec, gsNormal);
    gsGroup.quaternion.copy(gsQuaternion);

    const gsGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.2, 8);
    const gsMat = new THREE.MeshStandardMaterial({ color: 0x00ff66, emissive: 0x008822, metalness: 0.8 });
    groundStation = new THREE.Mesh(gsGeo, gsMat);
    gsGroup.add(groundStation);

    const ringGeo = new THREE.RingGeometry(0.2, 0.25, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    pingRing = new THREE.Mesh(ringGeo, ringMat);
    pingRing.rotation.x = Math.PI / 2;
    pingRing.position.y = 0.05;
    gsGroup.add(pingRing);
}

// --- WEBSOCKET HANDLER ---
function initWebSocket() {
    console.log("initWebSocket: Connecting to", `ws://${window.location.host}/ws`);
    ws = new WebSocket(`ws://${window.location.host}/ws`);

    ws.onopen = () => {
        console.log("initWebSocket: Connection opened");
        statusInd.textContent = "ONLINE - RF STREAM ACTIVE";
        statusInd.style.color = "var(--neon-green)";

        // Handshake current variables immediately
        ws.send(JSON.stringify({
            satellite_id: satelliteProfileSelect.value,
            frequency_mhz: parseFloat(satelliteProfileSelect.options[satelliteProfileSelect.selectedIndex].dataset.freq),
            noise_level: parseFloat(noiseSlider.value),
            quantum_shots: parseInt(quantumShotsInput.value),
            jamming_enabled: jammingToggle.checked,
            eavesdropping_enabled: eavesdroppingToggle.checked,
            ai_enabled: aiToggle.checked,
            quantum_enabled: quantumToggle.checked,
            time_scale: parseFloat(timeSlider.value),
            online: true
        }));
    };

    ws.onerror = (err) => {
        console.error("initWebSocket: Error:", err);
    };

    ws.onclose = (event) => {
        console.log("initWebSocket: Connection closed", event);
        statusInd.textContent = "CONNECTION LOST";
        statusInd.style.color = "var(--neon-red)";
    };

    ws.onmessage = (event) => {
        if (simState.fileUploadedMode) return;
        const data = JSON.parse(event.data);
        Object.assign(simState, data);
        updateDashboard(simState);
    };
}

// --- CONTROLS EVENT BINDINGS ---
function resetFileUploadMode() {
    if (simState.fileUploadedMode) {
        simState.fileUploadedMode = false;
        simState.fileAnomalyActive = false;
        if (window.csvPlaybackInterval) {
            clearInterval(window.csvPlaybackInterval);
            window.csvPlaybackInterval = null;
        }
        window.uploadedSignalState = null;
        const statusBox = document.getElementById('uploadStatus');
        if (statusBox) statusBox.textContent = "";

        const aiBox = document.getElementById('ai-alerts-box');
        if (aiBox) {
            aiBox.className = "box clear";
            aiBox.textContent = "NO ANOMALIES DETECTED. SYSTEM STABLE.";
        }
        // Reset file input value so same file can be uploaded again
        const fileUploader = document.getElementById('signalUploader');
        if (fileUploader) fileUploader.value = "";
    }
}

window.uploadedSignalState = null;

function renderPlaybackTick(index) {
    if (!window.uploadedSignalState || !window.uploadedSignalState.dataPoints) return;
    const dataPoints = window.uploadedSignalState.dataPoints;
    if (index >= dataPoints.length) {
        clearInterval(window.csvPlaybackInterval);
        window.csvPlaybackInterval = null;
        const jarvisLog = document.getElementById('jarvis-log');
        if (jarvisLog) {
            const p = document.createElement('p');
            p.innerHTML = `<span style="color: var(--neon-green);">[${new Date().toLocaleTimeString()}]</span> Finished playback of ${dataPoints.length} points from ${window.uploadedSignalState.fileName}.`;
            jarvisLog.prepend(p);
        }
        return;
    }

    const row = dataPoints[index];
    window.uploadedSignalState.playbackIndex = index;

    // Base values from CSV/JSON row
    const baseCarrier = parseFloat(row.carrier_mhz || row.carrier || 12000.0);
    const baseSnr = parseFloat(row.snr_db || row.snr || 0);
    const baseLoss = parseFloat(row.packet_loss || row.loss || 0);
    const baseQber = parseFloat(row.qber_rate || row.qber || 0);
    const baseNoise = parseFloat(row.atmospheric_noise || row.noise || 0);
    const baseSpeed = parseFloat(row.simulation_speed || row.speed || 1.0);

    // Recalculate based on manual slider positions
    const noiseSliderVal = parseFloat(noiseSlider.value);
    const noiseMultiplier = noiseSliderVal / 0.1;
    const adjustedNoise = baseNoise * noiseMultiplier;

    const speedSliderVal = parseFloat(timeSlider.value);
    const adjustedSpeed = baseSpeed * speedSliderVal;

    // Apply offset/multiplier mappings
    const snrOffset = (adjustedNoise - baseNoise) * 0.5;
    const adjustedSnr = Math.max(0, baseSnr - snrOffset);
    const adjustedLoss = Math.min(100, Math.max(0, baseLoss + (adjustedNoise - baseNoise) * 1.5));
    const adjustedQber = Math.min(1.0, Math.max(0.0, baseQber + (adjustedNoise - baseNoise) * 0.01));

    const noisePercent = adjustedNoise <= 1.0 ? adjustedNoise * 100 : adjustedNoise;
    const isAnomaly = parseInt(row.anomaly || row.anomaly_flag || 0) === 1 || noisePercent > 50 || row.anomaly === "true" || row.anomaly === true;

    // Update simState values for rendering loop
    simState.noiseLevel = adjustedNoise;
    simState.time_scale = adjustedSpeed;
    simState.anomaly = isAnomaly;
    simState.fileAnomalyActive = isAnomaly;

    // Update metric text fields
    document.getElementById('carrier-freq').textContent = baseCarrier.toFixed(2);
    document.getElementById('uplink-freq').textContent = (baseCarrier * 1.15).toFixed(2);
    document.getElementById('downlink-freq').textContent = (baseCarrier * 0.95).toFixed(2);

    // Update QK (BB84) Box text
    const qkBox = document.getElementById('qk-box');
    if (qkBox) {
        qkBox.className = "box";
        qkBox.style.borderColor = "var(--neon-purple)";
        qkBox.style.boxShadow = "inset 0 0 10px rgba(204,0,255,0.2)";
        const dummyKey = "1010110011010100110110";
        qkBox.innerHTML = `KEY: ${dummyKey.substring(0, 16)}...<br>QBER: ${(adjustedQber * 100).toFixed(1)}%<br><span style="color: ${adjustedQber > 0.15 ? 'var(--neon-red)' : 'var(--neon-green)'}; font-weight: bold;">${adjustedQber > 0.15 ? 'BREACH DETECTED' : 'SECURE CHANNEL'}</span>`;
    }

    // Drive charts
    const timestamp = row.timestamp || row.time || `Point ${index + 1}`;
    chartA.data.labels.push(timestamp);
    chartA.data.datasets[0].data.push(adjustedSnr);
    chartA.data.datasets[1].data.push(adjustedLoss);
    if (chartA.data.labels.length > 30) {
        chartA.data.labels.shift();
        chartA.data.datasets[0].data.shift();
        chartA.data.datasets[1].data.shift();
    }
    chartA.update('none');

    const downlink = parseFloat(row.downlink || row.downlink_mbps || Math.round(200 * (adjustedSnr + 5) / 55));
    const uplink = parseFloat(row.uplink || row.uplink_mbps || Math.round(75 * (adjustedSnr + 5) / 55));

    chartB.data.labels.push(timestamp);
    chartB.data.datasets[0].data.push(uplink);
    chartB.data.datasets[1].data.push(downlink);
    if (chartB.data.labels.length > 30) {
        chartB.data.labels.shift();
        chartB.data.datasets[0].data.shift();
        chartB.data.datasets[1].data.shift();
    }
    chartB.update('none');

    // AI Threat Box Trigger
    const aiBox = document.getElementById('ai-alerts-box');
    if (aiBox) {
        if (isAnomaly) {
            aiBox.className = "box alarm";
            aiBox.innerHTML = `ALARM_ID: FILE_PLAYBACK<br>WARNING: ANOMALY DETECTED IN SIGNAL DATA<br>NOISE: ${Math.round(noisePercent)}% | STATUS: CRITICAL`;
        } else {
            aiBox.className = "box clear";
            aiBox.textContent = "NO ANOMALIES DETECTED. SYSTEM STABLE.";
        }
    }

    // Log entry in Jarvis AI Log
    const jarvisLog = document.getElementById('jarvis-log');
    if (jarvisLog) {
        if (jarvisLog.textContent.includes("AWAITING SYSTEM INITIALIZATION...")) jarvisLog.innerHTML = "";
        const p = document.createElement('p');
        p.innerHTML = `<span style="color: var(--neon-blue);">[${new Date().toLocaleTimeString()}]</span> CSV Playback [${index + 1}/${dataPoints.length}]: SNR=${adjustedSnr.toFixed(1)}dB, Loss=${adjustedLoss.toFixed(1)}%, Noise=${Math.round(noisePercent)}%, Status=${isAnomaly ? 'WARNING' : 'NORMAL'}`;
        jarvisLog.prepend(p);
        if (jarvisLog.children.length > 8) jarvisLog.removeChild(jarvisLog.lastChild);
    }
}

// File Upload Event Handler
const fileUploader = document.getElementById('signalUploader');
if (fileUploader) {
    fileUploader.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Immediately update status container text
        const statusBox = document.getElementById('uploadStatus');
        if (statusBox) {
            statusBox.textContent = `📁 File Loaded: ${file.name}`;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rawContent = e.target.result.trim();
                let dataPoints = [];

                if (file.name.endsWith('.json')) {
                    const parsed = JSON.parse(rawContent);
                    dataPoints = Array.isArray(parsed) ? parsed : [parsed];
                } else if (file.name.endsWith('.csv')) {
                    const lines = rawContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    if (lines.length > 1) {
                        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
                        for (let i = 1; i < lines.length; i++) {
                            const values = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''));
                            const obj = {};
                            headers.forEach((header, index) => {
                                obj[header] = values[index];
                            });
                            dataPoints.push(obj);
                        }
                    }
                }

                if (dataPoints.length === 0) {
                    alert("No valid data points found in file.");
                    return;
                }

                // Initialize global uploaded state
                window.uploadedSignalState = {
                    fileLoaded: true,
                    fileName: file.name,
                    dataPoints: dataPoints,
                    playbackIndex: 0
                };

                // Turn on file uploaded mode
                simState.fileUploadedMode = true;

                // Clear charts to start playing back sequentially
                chartA.data.labels = [];
                chartA.data.datasets[0].data = [];
                chartA.data.datasets[1].data = [];
                chartA.update();

                chartB.data.labels = [];
                chartB.data.datasets[0].data = [];
                chartB.data.datasets[1].data = [];
                chartB.update();

                // Stop any existing playback interval
                if (window.csvPlaybackInterval) {
                    clearInterval(window.csvPlaybackInterval);
                }

                let playbackIndex = 0;

                // Function to play back a single tick
                const playNextRow = () => {
                    if (!window.uploadedSignalState) return;
                    if (playbackIndex >= dataPoints.length) {
                        clearInterval(window.csvPlaybackInterval);
                        window.csvPlaybackInterval = null;

                        const jarvisLog = document.getElementById('jarvis-log');
                        if (jarvisLog) {
                            const p = document.createElement('p');
                            p.innerHTML = `<span style="color: var(--neon-green);">[${new Date().toLocaleTimeString()}]</span> Finished playback of ${dataPoints.length} points from ${file.name}.`;
                            jarvisLog.prepend(p);
                        }
                        return;
                    }

                    renderPlaybackTick(playbackIndex);
                    playbackIndex++;
                };

                // Play first row immediately
                playNextRow();

                // Start periodic timeline playback (1 Hz scaled by simulation speed slider)
                const val = parseFloat(timeSlider.value) || 1.0;
                window.csvPlaybackInterval = setInterval(playNextRow, 1000 / val);

            } catch (err) {
                console.error("Error loading file:", err);
                alert("Error parsing file. Please ensure it is a valid CSV.");
            }
        };
        reader.readAsText(file);
    });
}

satelliteProfileSelect.onchange = () => {
    resetFileUploadMode();
    const opt = satelliteProfileSelect.options[satelliteProfileSelect.selectedIndex];
    const freq = parseFloat(opt.dataset.freq);
    const satId = satelliteProfileSelect.value;

    simState.satellite_id = satId;
    simState.current_frequency = freq;
    document.getElementById('carrier-freq').textContent = freq.toFixed(2);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ satellite_id: satId, frequency_mhz: freq }));
    }
};

noiseSlider.oninput = () => {
    if (simState.fileUploadedMode && window.uploadedSignalState) {
        const val = parseFloat(noiseSlider.value);
        document.getElementById('noise-val').textContent = Math.round(val * 100) + "%";
        renderPlaybackTick(window.uploadedSignalState.playbackIndex);
        return;
    }
    resetFileUploadMode();
    const val = parseFloat(noiseSlider.value);
    document.getElementById('noise-val').textContent = Math.round(val * 100) + "%";
    simState.noiseLevel = val;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ noise_level: val }));
    }
};

timeSlider.oninput = () => {
    if (simState.fileUploadedMode && window.uploadedSignalState) {
        const val = parseFloat(timeSlider.value);
        document.getElementById('time-val').textContent = val.toFixed(1) + "x";
        renderPlaybackTick(window.uploadedSignalState.playbackIndex);

        // Restart periodic interval with the new simulation speed
        if (window.csvPlaybackInterval) {
            clearInterval(window.csvPlaybackInterval);
            const playNextRow = () => {
                if (!window.uploadedSignalState) return;
                const nextIndex = window.uploadedSignalState.playbackIndex + 1;
                renderPlaybackTick(nextIndex);
            };
            window.csvPlaybackInterval = setInterval(playNextRow, 1000 / val);
        }
        return;
    }
    resetFileUploadMode();
    const val = parseFloat(timeSlider.value);
    document.getElementById('time-val').textContent = val.toFixed(1) + "x";
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ time_scale: val }));
    }
};

aiToggle.onchange = () => {
    resetFileUploadMode();
    simState.aiEnabled = aiToggle.checked;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ai_enabled: aiToggle.checked }));
    }
};

quantumToggle.onchange = () => {
    resetFileUploadMode();
    simState.quantumEnabled = quantumToggle.checked;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ quantum_enabled: quantumToggle.checked }));
    }
    if (quantumToggle.checked) {
        encStatus.textContent = "BB84 QUANTUM KEY DISTRIBUTION";
        encStatus.style.color = "var(--neon-purple)";
        encStatus.style.textShadow = "0 0 5px var(--neon-purple)";
    } else {
        encStatus.textContent = "Standard AES-256";
        encStatus.style.color = "var(--neon-green)";
        encStatus.style.textShadow = "none";
    }
};

quantumShotsInput.onchange = () => {
    resetFileUploadMode();
    const val = parseInt(quantumShotsInput.value) || 1024;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ quantum_shots: val }));
    }
};

jammingToggle.onchange = () => {
    resetFileUploadMode();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ jamming_enabled: jammingToggle.checked }));
    }
};

eavesdroppingToggle.onchange = () => {
    resetFileUploadMode();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ eavesdropping_enabled: eavesdroppingToggle.checked }));
    }
};

viewHistoryBtn.onclick = async () => {
    try {
        const res = await fetch('/api/telemetry/history');
        const data = await res.json();
        const jarvisLog = document.getElementById('jarvis-log');
        jarvisLog.innerHTML = "";

        if (data.length === 0) {
            jarvisLog.textContent = "NO DATABASE LOGS FOUND.";
            return;
        }

        data.forEach(log => {
            const p = document.createElement('p');
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            p.innerHTML = `<span style="color: #66b3ff;">[${timeStr}]</span> ${log.event_type} | SNR: <span style="color: ${log.snr < 10 ? 'red' : 'green'}">${log.snr.toFixed(1)} dB</span> | QKD Rate: ${log.qkd_key_rate} bps`;
            jarvisLog.prepend(p);
        });
    } catch (e) {
        console.error("Error loading telemetry history:", e);
    }
};

// --- RENDER LOOP & ORBIT PHYSICS ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    earthGroup.rotation.y += 0.0004;
    earthGroup.rotation.z = 0.2;

    clouds.rotation.y += 0.00065;

    pingRing.scale.x += 0.02;
    pingRing.scale.y += 0.02;
    pingRing.material.opacity -= 0.01;
    if (pingRing.scale.x > 3.0) {
        pingRing.scale.set(1, 1, 1);
        pingRing.material.opacity = 0.5;
    }

    simState.satellites.forEach(data => {
        if (!satellitesInfo[data.id]) {
            const mesh = createSatelliteMesh();
            scene.add(mesh);
            satellitesInfo[data.id] = mesh;

            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
            scene.add(line);
            beamsInfo[data.id] = line;

            packetsInfo[data.id] = [];
        }

        const sat = satellitesInfo[data.id];
        const satrec = satrecs[data.id];
        let lat, lon, alt;

        if (satrec) {
            try {
                const scaleTimeOffset = simState.time * 25000;
                const propDate = new Date(Date.now() + scaleTimeOffset);
                const gmst = satellite.gstime(propDate);
                const posAndVel = satellite.propagate(satrec, propDate);

                if (posAndVel && posAndVel.position) {
                    const posGd = satellite.eciToGeodetic(posAndVel.position, gmst);
                    lat = satellite.degreesLat(posGd.latitude);
                    lon = satellite.degreesLong(posGd.longitude);
                    alt = posGd.height;
                }
            } catch (err) {
                // Trigger fallback below
            }
        }

        if (lat === undefined || isNaN(lat) || isNaN(lon)) {
            const angle = simState.time * 0.15 + (parseInt(data.id.split('-')[1]) * 0.8);
            lat = 40 * Math.sin(angle);
            lon = ((angle * 1.4) * 50) % 360 - 180;
            alt = 500 + (parseInt(data.id.split('-')[1]) * 80);
        }

        const pos = latLonToVector3(lat, lon, alt);
        sat.position.copy(pos);

        sat.lookAt(0, 0, 0);
        sat.rotateX(Math.PI / 2);

        const gsGlobalPos = new THREE.Vector3();
        groundStation.getWorldPosition(gsGlobalPos);

        const beam = beamsInfo[data.id];
        const positions = beam.geometry.attributes.position.array;
        positions[0] = gsGlobalPos.x;
        positions[1] = gsGlobalPos.y;
        positions[2] = gsGlobalPos.z;
        positions[3] = pos.x;
        positions[4] = pos.y;
        positions[5] = pos.z;
        beam.geometry.attributes.position.needsUpdate = true;

        // Dynamic profile configuration for transmission lines and packets
        const profileCfg = getProfileConfig(simState.satellite_id);
        const targetCount = profileCfg.particleCount;

        // Resize packet count dynamically
        let packets = packetsInfo[data.id];
        if (packets.length !== targetCount) {
            while (packets.length > targetCount) {
                const p = packets.pop();
                scene.remove(p.mesh);
            }
            while (packets.length < targetCount) {
                const pMat = new THREE.MeshBasicMaterial({ color: profileCfg.color, transparent: true, opacity: 0.8 });
                const packet = new THREE.Mesh(packetGeo, pMat);
                scene.add(packet);
                packets.push({ mesh: packet, progress: Math.random() });
            }
        }

        // Animate packets along beam path
        packets.forEach(p => {
            p.progress += profileCfg.speed;
            if (p.progress > 1.0) p.progress = 0;

            const posCopy = new THREE.Vector3(pos.x, pos.y, pos.z);
            const packetPos = new THREE.Vector3().lerpVectors(gsGlobalPos, posCopy, p.progress);
            p.mesh.position.copy(packetPos);

            let pColor = profileCfg.color;
            if (simState.anomaly) pColor = 0xff003c;
            else if (simState.quantumEnabled) pColor = 0xcc00ff;

            p.mesh.material.color.setHex(pColor);
        });

        // Set beam lines matching state color rules
        let beamColor = profileCfg.color;
        if (simState.anomaly) {
            beamColor = 0xff003c;
        } else if (simState.quantumEnabled) {
            beamColor = 0xcc00ff;
        }
        beam.material.color.setHex(beamColor);
        beam.material.opacity = simState.anomaly ? 0.8 : 0.35;
    });

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- APPLICATION INITIALIZATION ---
console.log("initBlock: Starting...");
simulationStarted = true;
console.log("initBlock: simulationStarted set to true");
initThreeJS();
console.log("initBlock: initThreeJS completed");
initWebSocket();
console.log("initBlock: initWebSocket completed");
animate();
animateOscilloscope();
console.log("initBlock: animate started");
