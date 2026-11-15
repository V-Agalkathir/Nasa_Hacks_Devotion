Small derived inputs tracked in git so the automated workflow can rebuild everything from the
`data-v1` release: OpenStreetMap context layers with full geometry (the release copy has centre
points only) and the named-area outlines. (c) OpenStreetMap contributors, ODbL.
Refresh by hand: `python src/fetch_context.py`, then copy data/interim/context/*.geojson here.
