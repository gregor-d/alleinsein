import subprocess
import time
import urllib.request
import urllib.error
import pytest

@pytest.mark.skip(reason="Requires aiocache server to be running, and is more of an integration test than a unit test.")
def test():
    # Start the aiocache app using our WSL virtual environment python
    print("Starting aiocache server...")
    proc = subprocess.Popen(
        ["../.venv_wsl/bin/python3", "-m", "uvicorn", "main:app", "--port", "8082"],
        cwd="aiocache",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for server to start
    time.sleep(3)
    
    url = "http://127.0.0.1:8082/api/raster/WebMercatorQuad/tilejson.json?raster=raster.tif"
    
    try:
        print(f"Requesting: {url}")
        # First request (should be MISS if cache works, or not exist if caching doesn't work)
        req1 = urllib.request.Request(url)
        with urllib.request.urlopen(req1) as res1:
            headers1 = res1.info()
            print("Response 1 headers:")
            for k, v in headers1.items():
                if k.lower() in ["x-cache", "cache-control"]:
                    print(f"  {k}: {v}")
            
        print("\nRequesting again (should be HIT)...")
        # Second request
        req2 = urllib.request.Request(url)
        with urllib.request.urlopen(req2) as res2:
            headers2 = res2.info()
            print("Response 2 headers:")
            for k, v in headers2.items():
                if k.lower() in ["x-cache", "cache-control"]:
                    print(f"  {k}: {v}")
                    
    except Exception as e:
        print(f"Error occurred: {e}")
        if hasattr(e, "read"):
            print(e.read().decode())
    finally:
        print("Stopping server...")
        proc.terminate()
        proc.wait()
        stdout, stderr = proc.communicate()
        print("Server stdout/stderr printed.")
        print(stdout[:1000])
        print(stderr[:1000])

if __name__ == "__main__":
    test()
