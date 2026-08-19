#!/usr/bin/env python3
"""
====================================================================
EFFLUENT SCADA — ESP32 FIRMWARE TELEMETRY MOCK DATA PRODUCER
Industrial Water Quality & Automatic Safety Actuation Simulator
====================================================================

This script simulates an industrial ESP32 Remote Telemetry Unit (RTU)
transmitting sensor readings to the SCADA backend (/api/sensors/data).

It supports:
  - SAFE (Normal compliant industrial effluent)
  - WARNING (Approaching regulatory limits)
  - EMERGENCY (Severe hazardous breach triggering auto-cutoff)
  - DYNAMIC CYCLE (Realistic continuous transition between states)
  - INTERACTIVE MODE (Live keyboard switching between scenarios)

Usage:
  python mock_producer.py --help
  python mock_producer.py --scenario SAFE
  python mock_producer.py --scenario WARNING
  python mock_producer.py --scenario EMERGENCY
  python mock_producer.py --scenario CYCLE --interval 2.0
  python mock_producer.py --interactive
"""

import os
import sys
import time
import math
import random
import argparse
import datetime
import urllib.request
import urllib.error
import json
from typing import Dict, Any, Tuple

# ANSI Terminal Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


class SensorProfile:
    """Defines baseline sensor parameter ranges for different industrial effluent states."""

    @staticmethod
    def safe() -> Dict[str, Tuple[float, float]]:
        return {
            "ph": (6.9, 7.5),
            "tds": (380.0, 480.0),
            "turbidity": (12.0, 22.0),
            "temperature": (26.0, 29.5),
            "flow": (1.8, 2.4),
            "dissolved_oxygen": (6.5, 7.8),
            "cod": (30.0, 48.0),
            "bod": (12.0, 18.0),
            "ammonia": (0.2, 0.5),
            "heavy_metals": (0.001, 0.003),
            "gas_leakage_ppm": (0.0, 1.2),
        }

    @staticmethod
    def warning() -> Dict[str, Tuple[float, float]]:
        return {
            "ph": (6.1, 6.4),  # Mild acidification or 8.6-9.1
            "tds": (1050.0, 1350.0),  # Elevated dissolved minerals
            "turbidity": (55.0, 85.0),  # High particulate suspension
            "temperature": (36.0, 41.0),  # Mild thermal pollution
            "flow": (3.5, 4.8),
            "dissolved_oxygen": (3.8, 4.8),
            "cod": (110.0, 160.0),
            "bod": (40.0, 65.0),
            "ammonia": (1.2, 2.5),
            "heavy_metals": (0.015, 0.035),
            "gas_leakage_ppm": (5.0, 15.0),
        }

    @staticmethod
    def emergency() -> Dict[str, Tuple[float, float]]:
        return {
            "ph": (2.8, 3.8),  # Highly toxic acid spill (e.g. chemical bath breach)
            "tds": (2200.0, 3100.0),  # Extreme salinity / chemical salts
            "turbidity": (160.0, 280.0),  # Extreme sludge / clarifier collapse
            "temperature": (48.0, 56.0),  # Extreme thermal breach
            "flow": (6.5, 8.8),  # Surging pipe flow
            "dissolved_oxygen": (0.8, 1.8),  # Severe hypoxia
            "cod": (450.0, 850.0),  # Hazardous chemical oxygen demand
            "bod": (160.0, 320.0),
            "ammonia": (8.5, 18.0),
            "heavy_metals": (0.12, 0.45),
            "gas_leakage_ppm": (45.0, 120.0),
        }


def generate_sample(scenario: str, jitter: float = 0.05, step: int = 0) -> Dict[str, Any]:
    """Generates realistic telemetry packet with micro-drift noise."""
    scenario = scenario.upper()
    
    if scenario == "SAFE":
        ranges = SensorProfile.safe()
    elif scenario == "WARNING":
        ranges = SensorProfile.warning()
    elif scenario == "EMERGENCY" or scenario == "CRITICAL":
        ranges = SensorProfile.emergency()
    else:
        # Default safe
        ranges = SensorProfile.safe()

    # Apply sinusoidal drift and Gaussian noise
    drift = math.sin(step * 0.15) * jitter

    sample: Dict[str, Any] = {}
    for key, (low, high) in ranges.items():
        mid = (low + high) / 2.0
        spread = (high - low) / 2.0
        val = mid + spread * drift + random.gauss(0, spread * 0.1)
        val = max(0.0, val)
        
        if key == "ph":
            val = max(0.0, min(14.0, val))
            sample[key] = round(val, 2)
        elif key in ["tds", "turbidity", "temperature", "flow", "cod", "bod", "gas_leakage_ppm"]:
            sample[key] = round(val, 1)
        elif key == "heavy_metals":
            sample[key] = round(val, 4)
        else:
            sample[key] = round(val, 2)

    sample["source"] = "ESP32-PRODUCER"
    return sample


def post_telemetry(url: str, payload: Dict[str, Any], timeout: float = 5.0) -> Tuple[bool, Dict[str, Any], float]:
    """Sends JSON telemetry packet via HTTP POST to the SCADA server."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "ESP32-Firmware/2.4"},
    )
    
    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            latency_ms = (time.time() - start_time) * 1000.0
            resp_body = response.read().decode("utf-8")
            return True, json.loads(resp_body), latency_ms
    except urllib.error.HTTPError as e:
        latency_ms = (time.time() - start_time) * 1000.0
        try:
            err_body = e.read().decode("utf-8")
            return False, json.loads(err_body), latency_ms
        except Exception:
            return False, {"error": f"HTTP {e.code}: {e.reason}"}, latency_ms
    except Exception as e:
        latency_ms = (time.time() - start_time) * 1000.0
        return False, {"error": str(e)}, latency_ms


def format_status_badge(status: str) -> str:
    if status == "SAFE":
        return f"{GREEN}[ SAFE ]{RESET}"
    elif status == "WARNING":
        return f"{YELLOW}[ WARNING ]{RESET}"
    elif status in ["CRITICAL", "EMERGENCY"]:
        return f"{RED}{BOLD}[ EMERGENCY ]{RESET}"
    return f"{DIM}[ {status} ]{RESET}"


def format_actuator(valve: str, relay: str, discharge: str) -> str:
    v_color = GREEN if valve == "OPEN" else RED
    r_color = RED if relay == "ACTIVE" else GREEN
    d_color = GREEN if discharge == "ALLOWED" else RED
    return (
        f"Valve: {v_color}{valve}{RESET} | "
        f"Relay: {r_color}{relay}{RESET} | "
        f"Discharge: {d_color}{discharge}{RESET}"
    )


def print_banner(server_url: str, scenario: str, interval: float):
    print(f"\n{CYAN}{BOLD}{'=' * 84}{RESET}")
    print(f"{CYAN}{BOLD}  EFFLUENT SCADA — ESP32 HARDWARE TELEMETRY MOCK DATA PRODUCER{RESET}")
    print(f"{CYAN}{BOLD}{'=' * 84}{RESET}")
    print(f" {BOLD}Target Server URL:{RESET}  {server_url}")
    print(f" {BOLD}Simulated Device:{RESET}   ESP32 RTU Station Alpha-1 (12-bit ADC / GPIO Bus)")
    print(f" {BOLD}Initial Scenario:{RESET}   {MAGENTA}{scenario.upper()}{RESET}")
    print(f" {BOLD}Sampling Interval:{RESET}  {interval}s")
    print(f" {BOLD}Safety Protocols:{RESET}   Automatic Cutoff Feedback, Gmail SMTP Triggers")
    print(f"{CYAN}{'-' * 84}{RESET}\n")


def run_cycle_mode(server_url: str, interval: float, count: int):
    """Rotates smoothly between SAFE (20 cycles), WARNING (10 cycles), and EMERGENCY (10 cycles)."""
    step = 0
    while count == 0 or step < count:
        cycle_pos = step % 45
        if cycle_pos < 22:
            scenario = "SAFE"
        elif cycle_pos < 34:
            scenario = "WARNING"
        else:
            scenario = "EMERGENCY"

        payload = generate_sample(scenario, step=step)
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")

        success, response, latency = post_telemetry(server_url, payload)
        
        status = response.get("status", scenario)
        risk = response.get("riskScore", response.get("risk", 0))
        valve = response.get("valve", "OPEN" if status != "CRITICAL" else "CLOSED")
        relay = response.get("relay", "INACTIVE" if status != "CRITICAL" else "ACTIVE")
        discharge = response.get("discharge", "ALLOWED" if status != "CRITICAL" else "BLOCKED")

        badge = format_status_badge(status)
        actuators = format_actuator(valve, relay, discharge)

        print(
            f"[{CYAN}{timestamp}{RESET}] {badge} "
            f"pH:{BOLD}{payload['ph']:4.1f}{RESET} "
            f"TDS:{BOLD}{payload['tds']:5.0f}{RESET}ppm "
            f"Turb:{BOLD}{payload['turbidity']:4.0f}{RESET}NTU "
            f"Temp:{BOLD}{payload['temperature']:4.1f}{RESET}°C "
            f"Flow:{BOLD}{payload['flow']:3.1f}{RESET}L/m | "
            f"Risk:{RED if risk >= 80 else (YELLOW if risk >= 40 else GREEN)}{risk:2d}/100{RESET} | "
            f"{actuators} ({latency:.1f}ms)"
        )

        step += 1
        time.sleep(interval)


def run_fixed_mode(server_url: str, scenario: str, interval: float, count: int):
    """Continuously sends sensor readings of a fixed state (SAFE, WARNING, or EMERGENCY)."""
    step = 0
    while count == 0 or step < count:
        payload = generate_sample(scenario, step=step)
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")

        success, response, latency = post_telemetry(server_url, payload)

        status = response.get("status", scenario)
        risk = response.get("riskScore", response.get("risk", 0))
        valve = response.get("valve", "OPEN" if status not in ["CRITICAL", "EMERGENCY"] else "CLOSED")
        relay = response.get("relay", "INACTIVE" if status not in ["CRITICAL", "EMERGENCY"] else "ACTIVE")
        discharge = response.get("discharge", "ALLOWED" if status not in ["CRITICAL", "EMERGENCY"] else "BLOCKED")

        badge = format_status_badge(status)
        actuators = format_actuator(valve, relay, discharge)

        print(
            f"[{CYAN}{timestamp}{RESET}] {badge} "
            f"pH:{BOLD}{payload['ph']:4.1f}{RESET} "
            f"TDS:{BOLD}{payload['tds']:5.0f}{RESET}ppm "
            f"Turb:{BOLD}{payload['turbidity']:4.0f}{RESET}NTU "
            f"Temp:{BOLD}{payload['temperature']:4.1f}{RESET}°C "
            f"Flow:{BOLD}{payload['flow']:3.1f}{RESET}L/m | "
            f"Risk:{RED if risk >= 80 else (YELLOW if risk >= 40 else GREEN)}{risk:2d}/100{RESET} | "
            f"{actuators} ({latency:.1f}ms)"
        )

        step += 1
        time.sleep(interval)


def run_interactive_mode(server_url: str, interval: float):
    """Provides a continuous interactive CLI menu where you can change states on the fly."""
    import threading

    current_scenario = ["SAFE"]
    running = [True]

    def input_listener():
        print(f"\n{BOLD}Interactive Commands:{RESET}")
        print(f"  [1] Switch to {GREEN}SAFE{RESET} Effluent")
        print(f"  [2] Switch to {YELLOW}WARNING{RESET} Effluent")
        print(f"  [3] Switch to {RED}EMERGENCY{RESET} Effluent (Acid / Salinity Surge)")
        print(f"  [4] Auto {MAGENTA}CYCLE{RESET} Mode")
        print(f"  [q] Quit\n")

        while running[0]:
            try:
                cmd = input().strip()
                if cmd == "1":
                    current_scenario[0] = "SAFE"
                    print(f"\n>> {GREEN}Active Scenario set to SAFE{RESET}")
                elif cmd == "2":
                    current_scenario[0] = "WARNING"
                    print(f"\n>> {YELLOW}Active Scenario set to WARNING{RESET}")
                elif cmd == "3":
                    current_scenario[0] = "EMERGENCY"
                    print(f"\n>> {RED}{BOLD}Active Scenario set to EMERGENCY (Hazard Triggered){RESET}")
                elif cmd == "4":
                    current_scenario[0] = "CYCLE"
                    print(f"\n>> {MAGENTA}Active Scenario set to AUTO CYCLE{RESET}")
                elif cmd.lower() in ["q", "exit", "quit"]:
                    running[0] = False
                    break
            except (EOFError, KeyboardInterrupt):
                running[0] = False
                break

    thread = threading.Thread(target=input_listener, daemon=True)
    thread.start()

    step = 0
    while running[0]:
        scen = current_scenario[0]
        if scen == "CYCLE":
            cycle_pos = step % 45
            if cycle_pos < 22:
                scen = "SAFE"
            elif cycle_pos < 34:
                scen = "WARNING"
            else:
                scen = "EMERGENCY"

        payload = generate_sample(scen, step=step)
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")

        success, response, latency = post_telemetry(server_url, payload)

        status = response.get("status", scen)
        risk = response.get("riskScore", response.get("risk", 0))
        valve = response.get("valve", "OPEN" if status not in ["CRITICAL", "EMERGENCY"] else "CLOSED")
        relay = response.get("relay", "INACTIVE" if status not in ["CRITICAL", "EMERGENCY"] else "ACTIVE")
        discharge = response.get("discharge", "ALLOWED" if status not in ["CRITICAL", "EMERGENCY"] else "BLOCKED")

        badge = format_status_badge(status)
        actuators = format_actuator(valve, relay, discharge)

        print(
            f"[{CYAN}{timestamp}{RESET}] {badge} "
            f"pH:{BOLD}{payload['ph']:4.1f}{RESET} "
            f"TDS:{BOLD}{payload['tds']:5.0f}{RESET}ppm "
            f"Turb:{BOLD}{payload['turbidity']:4.0f}{RESET}NTU "
            f"Temp:{BOLD}{payload['temperature']:4.1f}{RESET}°C "
            f"Flow:{BOLD}{payload['flow']:3.1f}{RESET}L/m | "
            f"Risk:{RED if risk >= 80 else (YELLOW if risk >= 40 else GREEN)}{risk:2d}/100{RESET} | "
            f"{actuators} ({latency:.1f}ms)"
        )

        step += 1
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(
        description="EFFLUENT SCADA — ESP32 Hardware Telemetry Mock Data Producer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--host",
        type=str,
        default="http://localhost:3000",
        help="SCADA backend host URL (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--endpoint",
        type=str,
        default="/api/sensors/data",
        help="Sensor data ingestion endpoint (default: /api/sensors/data)",
    )
    parser.add_argument(
        "--scenario",
        type=str,
        choices=["SAFE", "WARNING", "EMERGENCY", "CYCLE"],
        default="CYCLE",
        help="Telemetry scenario: SAFE | WARNING | EMERGENCY | CYCLE (default: CYCLE)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=2.0,
        help="Telemetry packet transmission interval in seconds (default: 2.0)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=0,
        help="Number of packets to send (0 = infinite stream)",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Run in interactive mode to switch scenarios in real-time",
    )

    args = parser.parse_args()
    server_url = f"{args.host.rstrip('/')}/{args.endpoint.lstrip('/')}"

    print_banner(server_url, args.scenario, args.interval)

    try:
        if args.interactive:
            run_interactive_mode(server_url, args.interval)
        elif args.scenario.upper() == "CYCLE":
            run_cycle_mode(server_url, args.interval, args.count)
        else:
            run_fixed_mode(server_url, args.scenario.upper(), args.interval, args.count)
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Mock producer paused by operator. Exiting cleanly.{RESET}\n")


if __name__ == "__main__":
    main()
