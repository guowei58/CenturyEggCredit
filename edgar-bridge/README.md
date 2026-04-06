# Edgar bridge (EdgarTools + FastAPI)

## Windows: `pip` / `python` not found

1. Install Python 3.11+ from [python.org/downloads/windows](https://www.python.org/downloads/windows/) and check **Add python.exe to PATH**.
2. New terminal, then use **`python -m pip`** (not bare `pip`):

   ```powershell
   cd path\to\CenturyEggCredit\edgar-bridge
   python -m pip install -r requirements.txt
   $env:EDGAR_IDENTITY = "Your Name you@company.com"
   python -m uvicorn main:app --host 127.0.0.1 --port 8765
   ```

3. If `python` opens the Microsoft Store: **Settings → Apps → App execution aliases** → disable **python.exe** / **python3.exe** aliases.

## macOS / Linux

```bash
cd edgar-bridge
python3 -m pip install -r requirements.txt
export EDGAR_IDENTITY="Your Name you@company.com"
python3 -m uvicorn main:app --host 127.0.0.1 --port 8765
```

`EDGAR_IDENTITY` must be a descriptive string with contact info (SEC policy).
