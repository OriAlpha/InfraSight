#!/usr/bin/env python3
"""
test_sdk.py - Zero-Dependency SDK completion, conversations, and tracing tests.
"""

import os
import sys
import uuid

# Add current folder to path to allow importing infrasight from tests/
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import infrasight

def run_zero_dependency_demo():
    # Setup Configuration
    PROXY_BASE_URL = "http://localhost:3000/api/proxy/v1/openai"
    API_KEY = os.environ.get("DEEPINFRA_API_KEY", "invalid-or-missing-key")

    print("==================================================")
    print("      InfraSight Python SDK Integration Demo")
    print("      (Zero-Dependency fallback mode)")
    print(f"      Proxy Endpoint: {PROXY_BASE_URL}")
    print("==================================================\n")

    # Instantiate our zero-dependency Client
    client = infrasight.Client(
        api_key=API_KEY,
        base_url=PROXY_BASE_URL
    )

    # 1. Demo 1: PII Masking & Simple Completion
    print("1. [PII Masking Test] Sending completion request with mock sensitive data...")
    infrasight.set_user("demo_user_python")
    
    try:
        res = client.chat.completions.create(
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            messages=[
                {
                    "role": "user",
                    "content": "Hi! My contact is contact@company.com and phone is +1 (555) 019-2834. Card: 4111-2222-3333-4444."
                }
            ]
        )
        print("   [OK] Done! Response received:")
        print(f"   [Response]: {res.choices[0].message.content[:70]}...\n")
    except Exception as e:
        print(f"   [Error] Request sent. (If API key is invalid, this is logged under status 'error'). Details: {e}\n")

    # Reset user context
    infrasight.set_user(None)

    # 2. Demo 2: Multi-turn Conversation Thread Tracking
    print("2. [Conversations] Simulating a multi-turn conversation thread...")
    conv_id = f"conv_thread_{uuid.uuid4().hex[:6]}"
    
    with infrasight.conversation(conv_id):
        infrasight.set_user("demo_user_python")
        
        # Turn 1
        messages = [
            {"role": "system", "content": "You are a helpful travel assistant."},
            {"role": "user", "content": "Suggest a good city to visit in Europe."}
        ]
        print(f"   -> Turn 1 (Conversation: {conv_id})")
        
        try:
            res1 = client.chat.completions.create(
                model="meta-llama/Meta-Llama-3.1-8B-Instruct",
                messages=messages
            )
            reply1 = res1.choices[0].message.content
            print(f"      Assistant: {reply1[:60]}...")
            
            # Turn 2
            messages.append({"role": "assistant", "content": reply1})
            messages.append({"role": "user", "content": "What is the best month to go there?"})
            print("   -> Turn 2")
            
            res2 = client.chat.completions.create(
                model="meta-llama/non-existent-model-to-fail",
                messages=messages
            )
            print(f"      Assistant: {res2.choices[0].message.content[:60]}...")
        except Exception as e:
            print(f"   [Info] Conversation turns completed (real provider error triggered on Turn 2 as expected: {e})")

    infrasight.set_user(None)
    print("")

    # 3. Demo 3: Specialized LLM Tasks
    print("3. [Specialized Tasks] Simulating specialized LLM tasks (Summarization, Paraphrase, Code Gen)...")
    infrasight.set_user("demo_user_python")

    # A. Summarization
    print("   -> Running Summarization task...")
    try:
        client.chat.completions.create(
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            messages=[
                {
                    "role": "user",
                    "content": "Summarize this article: LLMs are powerful but require monitoring. InfraSight provides transparent proxying, tracing, and evaluations to optimize cost and quality."
                }
            ]
        )
        print("      [OK] Summarization logged.")
    except Exception:
        pass

    # B. Paraphrase
    print("   -> Running Paraphrase task...")
    try:
        client.chat.completions.create(
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            messages=[
                {
                    "role": "user",
                    "content": "Paraphrase this sentence: Observatory tools help developers catch bugs early in production."
                }
            ]
        )
        print("      [OK] Paraphrase logged.")
    except Exception:
        pass

    # C. Code Generation
    print("   -> Running Code Completion task...")
    try:
        client.chat.completions.create(
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            messages=[
                {
                    "role": "user",
                    "content": "Write a python function to check if a number is prime."
                }
            ]
        )
        print("      [OK] Code generation logged.\n")
    except Exception:
        pass

    infrasight.set_user(None)

    # 4. Demo 4: Nested Agent Trace Trees
    print("4. [Agent Tracing] Building nested execution spans...")
    demo_trace_id = f"trace_agent_{uuid.uuid4().hex[:6]}"
    
    with infrasight.trace("Customer Support Multi-Agent Run", trace_id=demo_trace_id):
        infrasight.set_user("demo_user_python")
        print(f"   Created Trace Session ID: {demo_trace_id}")
        
        # Step A: Intent Classifier
        print("   -> Running Intent Classifier Span...")
        try:
            client.chat.completions.create(
                model="meta-llama/Meta-Llama-3.1-8B-Instruct",
                messages=[
                    {"role": "system", "content": "Classify user query: refund, order_status, or other."},
                    {"role": "user", "content": "Where is my refund for #RF-9921?"}
                ],
                extra_headers={
                    "x-span-name": "Intent Classifier Model",
                    "x-span-type": "llm"
                }
            )
        except Exception:
            pass

        # Step B: Tool Call
        print("   -> Executing Database Query Tool...")
        infrasight.log_event(
            client=client,
            name="Refund Database Query",
            event_type="tool",
            model="postgres-refund-db",
            input_data="SELECT * FROM refunds WHERE id = 'RF-9921'",
            output_data="{'id': 'RF-9921', 'status': 'PROCESSING', 'amount': '$120.00'}"
        )

        # Step C: Sub-chain Span
        print("   -> Entering Response Generation Sub-Chain...")
        with infrasight.span("Drafting Response Chain", span_type="chain"):
            
            # Step D: Grandchild Completion call
            print("      -> Generating customer message...")
            try:
                client.chat.completions.create(
                    model="meta-llama/non-existent-model-to-fail",
                    messages=[
                        {"role": "system", "content": "Draft a polite email stating refund is processing."},
                        {"role": "user", "content": "Refund RF-9921 status: PROCESSING, amount: $120.00."}
                    ],
                    extra_headers={
                        "x-span-name": "Conversational Response Writer",
                        "x-span-type": "llm"
                    }
                )
            except Exception:
                pass

        print("   [OK] Done! Trace spans built successfully.")

    print("\n==================================================")
    print("Demo Execution Completed!")
    print("Verify results in the Web Dashboard.")
    print("==================================================")

def main():
    run_zero_dependency_demo()

if __name__ == "__main__":
    main()
