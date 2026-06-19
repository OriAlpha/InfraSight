#!/usr/bin/env python3
"""
test_hitl.py - Modular Human-in-the-Loop Tests for InfraSight
"""

import os
import sys
import uuid
import time
import json
import urllib.request

# Add current directory to path to allow importing infrasight
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import infrasight

API_URL = "http://localhost:3000/api"

def query_log_status(span_id):
    """Polls the InfraSight endpoint to check status."""
    url = f"{API_URL}/logs/{span_id}"
    req = urllib.request.Request(url, method="GET")
    try:
        response = urllib.request.urlopen(req)
        data = json.loads(response.read().decode("utf-8"))
        return data.get("status")
    except Exception:
        return None

def update_request_status(span_id, new_status):
    """Programmatically updates a log status to simulate dashboard actions."""
    url = f"{API_URL}/logs/{span_id}/status"
    req_data = json.dumps({"status": new_status}).encode("utf-8")
    req = urllib.request.Request(url, data=req_data, method="PATCH")
    req.add_header("Content-Type", "application/json")
    try:
        response = urllib.request.urlopen(req)
        return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Failed to update status: {e}")
        return None

def test_hitl_checkpoint(client, model, interactive=False):
    """Run HITL Transaction Approval workflow."""
    print("Running HITL Checkpoint Test...")
    trace_id = f"trace_hitl_{uuid.uuid4().hex[:6]}"
    span_id = f"span_txn_{uuid.uuid4().hex[:6]}"
    
    with infrasight.trace("High-Value Transfer Agent", trace_id=trace_id):
        infrasight.set_user("hitl_operator")

        # Step A: Intent Classifier Model
        print("   -> Step A: Running intent classifier...")
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "Analyze transaction requests. Respond with transfer details."},
                    {"role": "user", "content": "Please wire $15,000.00 from Account A to Account B."}
                ],
                extra_headers={
                    "x-span-name": "Transaction Intent Classifier",
                    "x-span-type": "llm"
                }
            )
        except Exception: pass

        # Step B: Policy Check
        print("   -> Step B: Policy Engine flag triggered (value > $10k limit).")
        infrasight.log_event(
            client=client,
            name="Compliance Threshold Check",
            event_type="check",
            model="policy-evaluator-v1",
            input_data="Transfer amount: $15,000.00",
            output_data="FLAG: Requires Manual Operator Sign-Off"
        )

        # Step C: Pause and write to DB
        print("   -> Step C: Logging validation request and pausing execution...")
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "Manual validation checkpoint service."},
                    {"role": "user", "content": "Requesting validation for $15,000.00 bank wire."}
                ],
                extra_headers={
                    "x-span-id": span_id,
                    "x-span-name": "Manual Sign-Off Checkpoint",
                    "x-span-type": "check",
                    "x-span-status": "awaiting_approval"
                }
            )
        except Exception: pass

        if interactive:
            print("--------------------------------------------------")
            print("!!! ACTION REQUIRED IN WEB DASHBOARD")
            print("--------------------------------------------------")
            print(f"URL: http://localhost:5173/traces")
            print(f"Find Trace: 'High-Value Transfer Agent' & click 'Approve' or 'Reject'")
            print("--------------------------------------------------\n")
            
            print("Waiting for human decision (polling InfraSight API)...")
            sys.stdout.write("Status: AWAITING_APPROVAL ")
            sys.stdout.flush()

            decision = None
            while True:
                status = query_log_status(span_id)
                if status == "success":
                    decision = "APPROVED"
                    break
                elif status == "rejected":
                    decision = "REJECTED"
                    break
                elif status is None:
                    print("\n[Error] Lost connection to InfraSight server.")
                    return False
                
                sys.stdout.write(".")
                sys.stdout.flush()
                time.sleep(2.0)
        else:
            print("   -> Simulation mode: Auto-approving transaction after 2.0s...")
            time.sleep(2.0)
            update_request_status(span_id, "success")
            
            decision = None
            for _ in range(5):
                status = query_log_status(span_id)
                if status == "success":
                    decision = "APPROVED"
                    break
                time.sleep(0.5)
            
            if not decision:
                decision = "APPROVED"

        print(f"\n*** DECISION DETECTED: {decision}")

        if decision == "APPROVED":
            infrasight.log_event(
                client=client,
                name="Bank Wire API Service",
                event_type="tool",
                model="ach-banking-gateway",
                input_data="POST /v1/wires {'amount': 15000, 'from': 'A', 'to': 'B'}",
                output_data="{'wire_id': 'ACH-55829', 'status': 'SETTLED'}"
            )
            print("[SUCCESS] Transfer of $15,000.00 has been COMPLETED successfully!")
        else:
            infrasight.log_event(
                client=client,
                name="Bank Wire API Service",
                event_type="tool",
                model="ach-banking-gateway",
                input_data="POST /v1/wires {'amount': 15000, 'from': 'A', 'to': 'B'}",
                output_data="",
                error_message="Transaction rejected by operator review."
            )
            print("[CANCELLED] Transfer CANCELLED by operator.")

        # Step D: Final Assistant Response
        print("   -> Step D: Generating final conversational response...")
        messages = [
            {"role": "system", "content": "You are a helpful banking assistant. Inform the user of the final decision."},
            {"role": "user", "content": "Please wire $15,000.00 from Account A to Account B."}
        ]
        if decision == "APPROVED":
            messages.append({"role": "assistant", "content": "Initiating transfer of $15,000.00... Checked policy... Limit exceeded. Requesting manager approval."})
            messages.append({"role": "system", "content": "The manager has APPROVED the transfer. Bank Wire Service returned ACH-55829. Confirm completion to user."})
        else:
            messages.append({"role": "assistant", "content": "Initiating transfer of $15,000.00... Checked policy... Limit exceeded. Requesting manager approval."})
            messages.append({"role": "system", "content": "The manager has REJECTED the transfer. Inform the user that the request has been cancelled."})

        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                extra_headers={
                    "x-span-name": "Final Confirmation Response" if decision == "APPROVED" else "Final Rejection Response",
                    "x-span-type": "llm"
                }
            )
            print(f"Assistant: {response.choices[0].message.content}\n")
            return True
        except Exception as e:
            print(f"Error generating final response: {e}\n")
            return False
        finally:
            infrasight.set_user(None)

def main():
    from openai import OpenAI
    PROXY_BASE_URL = "http://localhost:3000/api/proxy/v1/openai"
    API_KEY = os.environ.get("DEEPINFRA_API_KEY", "invalid-or-missing-key")
    client = OpenAI(api_key=API_KEY, base_url=PROXY_BASE_URL)
    infrasight.wrap(client)

    model = "meta-llama/Meta-Llama-3.1-8B-Instruct"

    print("--------------------------------------------------")
    print("InfraSight Interactive HITL Demo")
    print("--------------------------------------------------")
    test_hitl_checkpoint(client, model, interactive=True)

if __name__ == "__main__":
    main()
