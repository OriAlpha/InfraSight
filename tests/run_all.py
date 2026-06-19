#!/usr/bin/env python3
"""
run_all.py - Fully Unified, Function-based, Modular InfraSight Test Suite
"""

import os
import sys
from openai import OpenAI

# Add current directory and parent directory to path to allow importing infrasight and test modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import infrasight

from tests.test_integration import test_pii_masking, test_conversations, test_specialized_tasks, test_agent_traces
from tests.test_guardrails import test_keyword_blocking, test_pii_redaction, test_safety_judge
from tests.test_hitl import test_hitl_checkpoint

PROXY_BASE_URL = "http://localhost:3000/api/proxy/v1/openai"
API_KEY = os.environ.get("DEEPINFRA_API_KEY")

if not API_KEY:
    for env_path in [".env", "../.env"]:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith("DEEPINFRA_API_KEY="):
                            key = line.strip().split("=", 1)[1].strip()
                            if (key.startswith('"') and key.endswith('"')) or (key.startswith("'") and key.endswith("'")):
                                key = key[1:-1]
                            API_KEY = key
                            break
            except Exception:
                pass

if not API_KEY:
    API_KEY = "invalid-or-missing-key"

def run_test_header(num, title):
    print("\n" + "="*60)
    print(f" TEST {num}: {title}")
    print("="*60)

def main():
    print("==========================================================")
    print("       InfraSight Comprehensive Request Test Suite")
    print("==========================================================")
    print(f"Proxy Host: {PROXY_BASE_URL}")

    client = OpenAI(api_key=API_KEY, base_url=PROXY_BASE_URL)
    infrasight.wrap(client)

    model = "meta-llama/Meta-Llama-3.1-8B-Instruct"

    # 1. SDK PII Masking
    run_test_header(1, "SDK PII MASKING (LOG LEVEL)")
    test_pii_masking(client, model)

    # 2. SDK Conversations
    run_test_header(2, "SDK CONVERSATIONS (THREAD TRACKING)")
    test_conversations(client, model)

    # 3. SDK Specialized Tasks
    run_test_header(3, "SDK SPECIALIZED CLASSIFICATIONS")
    test_specialized_tasks(client, model)

    # 4. SDK Agent Traces and Spans
    run_test_header(4, "SDK AGENT TRACES & SPAN TREES")
    test_agent_traces(client, model)

    # 5. Deterministic Keyword Blocking
    run_test_header(5, "ACTIVE PROXY KEYWORD BLOCKING")
    test_keyword_blocking(client, model)

    # 6. Active Proxy PII Redaction
    run_test_header(6, "ACTIVE PROXY PII REDACTION")
    test_pii_redaction(client, model)

    # 7. Automated Human-in-the-Loop
    run_test_header(7, "AUTOMATED HUMAN-IN-THE-LOOP APPROVAL")
    test_hitl_checkpoint(client, model, interactive=False)

    # 8. Background Safety Judge
    run_test_header(8, "BACKGROUND SAFETY JUDGE (LLM-AS-A-JUDGE)")
    test_safety_judge(client, model, wait_time=8)

    print("\n" + "="*60)
    print(" ALL TESTS COMPLETE SUCCESSFULLY!")
    print("="*60)
    print("Verify results in the Web Dashboard.")
    print("==========================================================")

if __name__ == "__main__":
    main()
