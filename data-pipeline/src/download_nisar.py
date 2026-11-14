"""Step 2a — download NISAR GUNW files listed in granules.csv.
Needs an Earthdata login: export EARTHDATA_USER / EARTHDATA_PASS.
"""
import csv, os
import asf_search as asf
from common import load_config, path

cfg = load_config()
session = asf.ASFSession().auth_with_creds(os.environ["EARTHDATA_USER"], os.environ["EARTHDATA_PASS"])
urls = [r["url"] for r in csv.DictReader(open(path(cfg, "interim") / "granules.csv"))
        if r["source"] == "NISAR" and r["url"]]
print(f"downloading {len(urls)} files…")
asf.download_urls(urls=urls, path=str(path(cfg, "raw")), session=session, processes=4)
