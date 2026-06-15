from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
import asyncio
import json
import random
import math
import numpy as np
from sklearn.ensemble import IsolationForest
import datetime
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy import Column, Integer, Float, String, Boolean, DateTime
from sqlalchemy import select

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def get():
    with open("static/index.html", "r") as f:
        return HTMLResponse(f.read())

# Database Setup
DATABASE_URL = "sqlite+aiosqlite:///./telemetry.db"
engine = create_async_engine(DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

class TelemetryLog(Base):
    __tablename__ = "telemetry_history"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    noise_level = Column(Float)
    snr = Column(Float)
    is_anomaly = Column(Boolean)
    anomaly_score = Column(Float)
    qkd_key_rate = Column(Float)
    event_type = Column(String)

@app.on_event("startup")
async def on_startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def log_telemetry_async(noise_level, snr, is_anomaly, anomaly_score, qkd_key_rate, event_type):
    try:
        async with async_session() as session:
            log_entry = TelemetryLog(
                noise_level=noise_level,
                snr=snr,
                is_anomaly=is_anomaly,
                anomaly_score=anomaly_score,
                qkd_key_rate=qkd_key_rate,
                event_type=event_type
            )
            session.add(log_entry)
            await session.commit()
    except Exception as e:
        print(f"Error logging telemetry: {e}")

class BB84Engine:
    def run_protocol(self, num_bits=1024, eavesdropped=False):
        # 1. Alice generates random bits and bases (0: Rectilinear +, 1: Diagonal x)
        alice_bits = np.random.randint(0, 2, num_bits)
        alice_bases = np.random.randint(0, 2, num_bits)
        
        # 2. Quantum Channel and Eavesdropper collapse
        if eavesdropped:
            # Eve intercepts: chooses random bases and measures qubits
            eve_bases = np.random.randint(0, 2, num_bits)
            eve_measured = np.where(alice_bases == eve_bases, alice_bits, np.random.randint(0, 2, num_bits))
            
            # Bob receives the collapsed qubits measured by Eve
            bob_incoming_bits = eve_measured
            bob_incoming_bases = eve_bases
        else:
            bob_incoming_bits = alice_bits
            bob_incoming_bases = alice_bases
            
        # 3. Bob measures incoming qubits in random bases
        bob_bases = np.random.randint(0, 2, num_bits)
        bob_measured = np.where(bob_incoming_bases == bob_bases, bob_incoming_bits, np.random.randint(0, 2, num_bits))
        
        # 4. Basis Reconciliation (Sifting)
        matching_bases = (alice_bases == bob_bases)
        sifted_alice = alice_bits[matching_bases]
        sifted_bob = bob_measured[matching_bases]
        
        if len(sifted_alice) == 0:
            return {
                "key": "",
                "qber": 0.0,
                "key_rate": 0.0,
                "status": "NO_MATCHING_BASES"
            }
            
        # 5. QBER Estimation (sample 10% of keys)
        sample_size = max(1, len(sifted_alice) // 10)
        sample_indices = np.random.choice(len(sifted_alice), sample_size, replace=False)
        
        sample_alice = sifted_alice[sample_indices]
        sample_bob = sifted_bob[sample_indices]
        
        errors = np.sum(sample_alice != sample_bob)
        qber = float(errors / sample_size)
        
        # 6. Cryptographic Key Extraction & Abort Threshold
        if qber > 0.15:
            return {
                "key": "BREACH_DETECTED",
                "qber": qber,
                "key_rate": 0.0,
                "status": f"ABORTED_EAVESDROPPING (QBER={qber:.2%})"
            }
            
        remaining_mask = np.ones(len(sifted_alice), dtype=bool)
        remaining_mask[sample_indices] = False
        key_alice = sifted_alice[remaining_mask]
        key_bob = sifted_bob[remaining_mask]
        
        # Error correction (parity sifting) & Privacy Amplification
        if len(key_alice) >= 2:
            final_key_bits = (key_alice[:-1:2] ^ key_alice[1::2])
            final_key_str = "".join(str(b) for b in final_key_bits[:16])
        else:
            final_key_str = "10101010"
            
        key_rate = len(final_key_str) * 30
        
        return {
            "key": final_key_str,
            "qber": qber,
            "key_rate": key_rate,
            "status": "SECURE_KEY_ESTABLISHED"
        }

class SimulationState:
    def __init__(self):
        self.time = 0.0
        self.noise_level = 0.1
        self.ai_enabled = False
        self.quantum_enabled = False
        self.is_online = True
        self.time_scale = 1.0
        
        # New selection controls
        self.satellite_id = "starlink"
        self.frequency_mhz = 12000.0
        self.quantum_shots = 1024
        self.jamming_enabled = False
        self.eavesdropping_enabled = False

        self.satellites = [
            {"id": "SAT-1", "orbit_radius": 6, "inclination": 45, "speed": 0.05, "offset": 0.0},
            {"id": "SAT-2", "orbit_radius": 8, "inclination": 60, "speed": 0.03, "offset": 2.0},
            {"id": "SAT-3", "orbit_radius": 5, "inclination": 30, "speed": 0.06, "offset": 4.0},
            {"id": "SAT-4", "orbit_radius": 7, "inclination": 80, "speed": 0.02, "offset": 1.0},
            {"id": "SAT-5", "orbit_radius": 6.5, "inclination": -20, "speed": 0.045, "offset": 3.0},
            {"id": "SAT-6", "orbit_radius": 5.5, "inclination": -45, "speed": 0.055, "offset": 5.0},
            {"id": "SAT-7", "orbit_radius": 7.5, "inclination": 15, "speed": 0.035, "offset": 6.0},
        ]
        self.rf = { "uplink": 13800.0, "downlink": 11400.0, "snr": 35.0 }
        
        # BB84 QKD Engine
        self.qkd_engine = BB84Engine()
        
        self.tick_counter = 0
        
        # Machine Learning: IsolationForest pre-training on baseline data
        # Feature Matrix: [frequency_stability, SNR, packet_jitter]
        X_train = []
        for _ in range(300):
            freq_stability = float(1.0 - abs(np.random.normal(0, 0.005)))
            snr_val = float(20.0 + np.random.normal(0, 2.0))
            jitter = float(0.02 + abs(np.random.normal(0, 0.005)))
            X_train.append([freq_stability, snr_val, jitter])
            
        self.clf = IsolationForest(contamination=0.05, random_state=42)
        self.clf.fit(X_train)
        self.normal_history = list(X_train)

    def update(self):
        if self.is_online:
            self.time += 0.05 * self.time_scale
            
        current_time = self.time
            
        # Update satellite positions
        active_sats = []
        for sat in self.satellites:
            lat = sat["inclination"] * math.sin(current_time * sat["speed"] + sat["offset"])
            lon = ((current_time * sat["speed"] * 1.5 + sat["offset"]) * 50) % 360 - 180
            active_sats.append({
                "id": sat["id"],
                "orbit_radius": sat["orbit_radius"],
                "lat": lat,
                "lon": lon,
                "angle": current_time * sat["speed"] + sat["offset"]
            })
            
        # DSP Telemetry Simulation
        if self.is_online:
            N = 256
            
            # Map frequencies to visual wave frequencies for oscilloscope display
            if self.satellite_id == "noaa":
                vis_freq = 5.0
            elif self.satellite_id == "gps":
                vis_freq = 15.0
            else:
                vis_freq = 30.0
                
            t_vec = np.arange(N) / 1000.0
            # Continuous Sine Wave Signal model
            carrier = np.sin(2 * np.pi * vis_freq * t_vec * 10 + self.time * 5.0)
            
            # Atmospheric Gaussian Noise Level
            effective_noise_level = self.noise_level
            if self.jamming_enabled:
                effective_noise_level += 0.8
                
            noise_variance = (effective_noise_level ** 2) + 0.001
            noise = np.random.normal(0, np.sqrt(noise_variance), N)
            
            # Apply Jamming Vector noise/interference
            if self.jamming_enabled:
                jamming_tone = 0.6 * np.sin(2 * np.pi * 75.0 * t_vec)
                rx_signal = carrier + noise + jamming_tone
            else:
                rx_signal = carrier + noise
                
            # Signal and Noise Power calculations
            sig_power = float(np.mean(carrier ** 2))
            noise_power = float(np.mean((rx_signal - carrier) ** 2))
            calculated_snr = 10 * np.log10(sig_power / (noise_power + 1e-10))
            calculated_snr = max(-10.0, min(50.0, calculated_snr))
            
            # Generate raw waveform array for dashboard oscilloscope
            waveform_array = rx_signal[:100].tolist()
            
            # Feature updates for ML model [frequency_stability, SNR, packet_jitter]
            if self.jamming_enabled:
                freq_stability = float(0.4 - abs(np.random.normal(0, 0.08)))
                jitter = float(0.85 + abs(np.random.normal(0, 0.15)))
            else:
                freq_stability = float(1.0 - abs(np.random.normal(0, 0.005)))
                jitter = float(0.02 + abs(np.random.normal(0, 0.005)))
                
            # IsolationForest Predictor
            anomaly = False
            predictive_score = 0
            
            if self.ai_enabled:
                features = [[freq_stability, calculated_snr, jitter]]
                pred = self.clf.predict(features)[0]
                score = self.clf.decision_function(features)[0]
                
                if pred == -1 or self.jamming_enabled:
                    anomaly = True
                    anomaly_status = "ANOMALY DETECTED"
                    predictive_score = int(min(100, max(75, 75 - score * 100)))
                else:
                    anomaly = False
                    anomaly_status = "OPERATIONAL"
                    predictive_score = int(max(0, min(45, 20 - score * 100)))
                    
                # Dynamic model retraining with sliding normal metrics
                if not self.jamming_enabled and self.noise_level <= 0.2:
                    self.normal_history.append([freq_stability, calculated_snr, jitter])
                    if len(self.normal_history) > 300:
                        self.normal_history.pop(0)
                    if self.tick_counter % 100 == 0:
                        self.clf.fit(self.normal_history)
            else:
                anomaly_status = "ANOMALY DETECTED" if self.jamming_enabled else "OPERATIONAL"
                anomaly = self.jamming_enabled
                
            # Quantum Key Distribution
            quantum_key = ""
            qber = 0.0
            qkd_key_rate = 0.0
            if self.quantum_enabled:
                qkd_res = self.qkd_engine.run_protocol(num_bits=self.quantum_shots, eavesdropped=self.eavesdropping_enabled)
                quantum_key = qkd_res["key"]
                qber = qkd_res["qber"]
                qkd_key_rate = qkd_res["key_rate"]
                
            # Update RF variables
            self.rf = {
                "carrier": self.frequency_mhz,
                "uplink": round(self.frequency_mhz * 1.15, 2),
                "downlink": round(self.frequency_mhz * 0.95, 2),
                "snr": round(calculated_snr, 1)
            }
            
            # Asynchronous DB Logging
            self.tick_counter += 1
            if self.tick_counter % 60 == 0:
                event_type = "NORMAL"
                if self.jamming_enabled:
                    event_type = "JAMMING"
                elif anomaly:
                    event_type = "ANOMALY"
                
                asyncio.create_task(
                    log_telemetry_async(
                        noise_level=self.noise_level,
                        snr=calculated_snr,
                        is_anomaly=anomaly,
                        anomaly_score=float(predictive_score),
                        qkd_key_rate=float(qkd_key_rate if self.quantum_enabled else 0.0),
                        event_type=event_type
                    )
                )
        else:
            waveform_array = [0.0] * 100
            anomaly = False
            anomaly_status = "OPERATIONAL"
            predictive_score = 0
            quantum_key = ""
            qber = 0.0
            qkd_key_rate = 0.0
            calculated_snr = 0.0
            
        return {
            "time": self.time,
            "satellites": active_sats,
            "waveform": waveform_array,
            "anomaly": anomaly,
            "anomaly_status": anomaly_status,
            "predictive_score": predictive_score,
            "quantum_key": quantum_key,
            "qber": qber,
            "noise_level": self.noise_level,
            "jamming_enabled": self.jamming_enabled,
            "eavesdropping_enabled": self.eavesdropping_enabled,
            "rf": self.rf,
            "is_online": self.is_online,
            "satellite_id": self.satellite_id,
            "current_frequency": self.frequency_mhz
        }

sim_state = SimulationState()

@app.get("/api/rf-data")
def get_rf_data():
    return sim_state.rf

@app.get("/api/satellites")
def get_satellites():
    state = sim_state.update()
    return {"satellites": state["satellites"]}

@app.get("/api/telemetry/history")
async def get_telemetry_history():
    try:
        async with async_session() as session:
            result = await session.execute(
                select(TelemetryLog).order_by(TelemetryLog.timestamp.desc()).limit(50)
            )
            logs = result.scalars().all()
            return [
                {
                    "id": log.id,
                    "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                    "noise_level": log.noise_level,
                    "snr": log.snr,
                    "is_anomaly": log.is_anomaly,
                    "anomaly_score": log.anomaly_score,
                    "qkd_key_rate": log.qkd_key_rate,
                    "event_type": log.event_type
                }
                for log in logs
            ]
    except Exception as e:
        return {"error": str(e)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=0.033) # ~30fps
                config = json.loads(data)
                if "satellite_id" in config: sim_state.satellite_id = str(config["satellite_id"])
                if "frequency_mhz" in config: sim_state.frequency_mhz = float(config["frequency_mhz"])
                if "noise_level" in config: sim_state.noise_level = float(config["noise_level"])
                if "quantum_shots" in config: sim_state.quantum_shots = int(config["quantum_shots"])
                if "jamming_enabled" in config: sim_state.jamming_enabled = bool(config["jamming_enabled"])
                if "eavesdropping_enabled" in config: sim_state.eavesdropping_enabled = bool(config["eavesdropping_enabled"])
                if "ai_enabled" in config: sim_state.ai_enabled = bool(config["ai_enabled"])
                if "quantum_enabled" in config: sim_state.quantum_enabled = bool(config["quantum_enabled"])
                if "online" in config: sim_state.is_online = bool(config["online"])
                if "time_scale" in config: sim_state.time_scale = float(config["time_scale"])
            except asyncio.TimeoutError:
                pass
            
            state = sim_state.update()
            await websocket.send_text(json.dumps(state))
    except WebSocketDisconnect:
        print("Client disconnected")

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
