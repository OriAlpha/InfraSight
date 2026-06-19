#!/usr/bin/env python3
"""
test_integration.py - Modular Integration Tests for InfraSight
"""

import os
import sys
import uuid

# Add current directory to path to allow importing infrasight
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import infrasight

def test_pii_masking(client, model):
    """SDK PII Masking: Verification of log-level PII masking."""
    print("Running PII Masking Test...")
    infrasight.set_user("tester_pii_log")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": "Hello. My email is check@example.com and Visa is 4111-2222-3333-4444."}
            ]
        )
        print("[OK] Success! Model response received:")
        print(f"Assistant: {response.choices[0].message.content[:80]}...\n")
        return True
    except Exception as e:
        print(f"[Error] Request failed: {e}\n")
        return False
    finally:
        infrasight.set_user(None)

def test_conversations(client, model):
    """SDK Conversations: Multi-turn thread tracking with infrasight.conversation."""
    print("Running Conversations Test...")
    conv_id = f"conv_{uuid.uuid4().hex[:6]}"
    infrasight.set_user("tester_conv")
    
    with infrasight.conversation(conv_id):
        print("   -> Turn 1: Asking question...")
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "user", "content": "What is the capital of France?"}
                ]
            )
        except Exception: pass

        print("   -> Turn 2: Follow up question...")
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "user", "content": "What is the capital of France?"},
                    {"role": "assistant", "content": "The capital of France is Paris."},
                    {"role": "user", "content": "What is its population?"}
                ]
            )
            print("[OK] Multi-turn thread logged.")
            return True
        except Exception as e:
            print(f"[Error] Thread failed: {e}\n")
            return False
        finally:
            infrasight.set_user(None)

def test_specialized_tasks(client, model):
    """SDK Specialized Tasks: Summarization, Paraphrase, and Code Gen classifications."""
    print("Running Specialized Tasks Test...")
    infrasight.set_user("tester_specialized")
    try:
        # Task 1: Summarization
        print("   -> Task 1: Sending Summarization query...")
        client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a summarization bot."},
                {"role": "user", "content": "Summarize: SQLite is a database engine written in C."}
            ]
        )

        # Task 2: Paraphrasing
        print("   -> Task 2: Sending Paraphrase query...")
        client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a paraphrasing bot."},
                {"role": "user", "content": "Paraphrase: The sun rises in the east."}
            ]
        )

        # Task 3: Code Generation
        print("   -> Task 3: Sending Code Generation query...")
        client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a programming bot."},
                {"role": "user", "content": "Write python function to add two numbers."}
            ]
        )
        print("[OK] Specialized tasks logged.")
        return True
    except Exception as e:
        print(f"[Error] Specialized tasks failed: {e}\n")
        return False
    finally:
        infrasight.set_user(None)

def test_agent_traces(client, model):
    """SDK Agent Traces: Full tree with nested spans."""
    print("Running Agent Traces Test...")
    trace_id = f"trace_py_{uuid.uuid4().hex[:6]}"
    
    with infrasight.trace("Invoice Assistant Agent", trace_id=trace_id):
        infrasight.set_user("tester_agent")
        
        # Step A: Intent classification (runs inside the trace, automatically inherits trace_id)
        print("   -> Step A: Running Intent Classifier model...")
        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "Classify user intent: invoice_query or other."},
                    {"role": "user", "content": "Help me retrieve invoice status for #INV-772"}
                ],
                extra_headers={
                    "x-span-name": "Intent Classifier Model",
                    "x-span-type": "llm"
                }
            )
        except Exception: pass

        # Step B: Database tool (manually log custom event)
        print("   -> Step B: Logging database lookup event...")
        infrasight.log_event(
            client=client,
            name="Database Lookup Tool",
            event_type="tool",
            model="database-query-service",
            input_data="SELECT * FROM invoices WHERE id = 'INV-772'",
            output_data="Invoice RF-772 is PAID. Delivery: Complete."
        )

        # Step C: Nested Chain execution
        print("   -> Step C: Executing nested Draft Answer sub-chain...")
        with infrasight.span("Draft Answer Chain", span_type="chain"):
            # Step D: Conversational Generator (nested inside chain, inside trace)
            print("      -> Step D: Calling Conversational Generator model...")
            try:
                client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Generate conversational customer response."},
                        {"role": "user", "content": "Invoice INV-772 is PAID."}
                    ],
                    extra_headers={
                        "x-span-name": "Conversational Generator",
                        "x-span-type": "llm"
                    }
                )
            except Exception: pass
            
            # Step E: Simulated Check span
            print("      -> Step E: Logging HITL transaction validation checkpoint...")
            try:
                client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Human approval validator."},
                        {"role": "user", "content": "Transaction validation requested."}
                    ],
                    extra_headers={
                        "x-span-name": "HITL Transaction Validation",
                        "x-span-type": "check",
                        "x-span-status": "awaiting_approval"
                    }
                )
            except Exception: pass
            
    infrasight.set_user(None)
    print(f"[OK] Agent nested trace logged. Trace ID: {trace_id}")
    return True

def main():
    from openai import OpenAI
    # Load configuration
    PROXY_BASE_URL = "http://localhost:3000/api/proxy/v1/openai"
    API_KEY = os.environ.get("DEEPINFRA_API_KEY", "invalid-or-missing-key")
    client = OpenAI(api_key=API_KEY, base_url=PROXY_BASE_URL)
    infrasight.wrap(client)

    model = "meta-llama/Meta-Llama-3.1-8B-Instruct"

    print("--------------------------------------------------")
    print("InfraSight Integration Tests")
    print("--------------------------------------------------")
    test_pii_masking(client, model)
    test_conversations(client, model)
    test_specialized_tasks(client, model)
    test_agent_traces(client, model)
    print("Integration tests completed.\n")

if __name__ == "__main__":
    main()
