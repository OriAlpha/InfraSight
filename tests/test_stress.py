#!/usr/bin/env python3
"""
test_stress.py - Concurrency Stress Test for InfraSight
"""

import os
import sys
import time
import concurrent.futures
from openai import OpenAI

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

PROXY_BASE_URL = "http://localhost:3000/api/proxy/v1/openai"
# Using mock API key to avoid calling external provider during stress test
API_KEY = "mock-api-key"

def send_request(client, thread_id):
    start = time.time()
    try:
        response = client.chat.completions.create(
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            messages=[
                {"role": "user", "content": f"Stress test message from thread {thread_id}"}
            ]
        )
        duration = time.time() - start
        content = response.choices[0].message.content
        print(f"[Thread {thread_id}] SUCCESS in {duration:.2f}s | Response: {content[:40]}...")
        return True
    except Exception as e:
        duration = time.time() - start
        print(f"[Thread {thread_id}] FAILED in {duration:.2f}s | Error: {e}")
        return False

def run_stress_test(concurrency=10):
    print("--------------------------------------------------")
    print(f"Starting Concurrency Stress Test ({concurrency} Threads)...")
    print(f"Proxy URL: {PROXY_BASE_URL}")
    print("--------------------------------------------------\n")
    
    client = OpenAI(api_key=API_KEY, base_url=PROXY_BASE_URL)
    
    start_time = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(send_request, client, i) for i in range(concurrency)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
        
    total_time = time.time() - start_time
    success_count = sum(1 for r in results if r)
    fail_count = len(results) - success_count
    
    print("\n--------------------------------------------------")
    print("Stress Test Summary:")
    print(f"Total Requests: {len(results)}")
    print(f"Success: {success_count}")
    print(f"Failures: {fail_count}")
    print(f"Execution Time: {total_time:.2f}s")
    print(f"Throughput: {len(results)/total_time:.2f} req/sec")
    print("--------------------------------------------------")
    return success_count == len(results)

def main():
    run_stress_test(concurrency=20)

if __name__ == "__main__":
    main()
