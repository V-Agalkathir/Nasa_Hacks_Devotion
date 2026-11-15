Small derived inputs tracked in git so the automated workflow can rebuild everything from the
`data-v1` release: OpenStreetMap context layers with full geometry (the release copy has centre
points only) and the named-area outlines. (c) OpenStreetMap contributors, ODbL.
Refresh by hand: `python src/fetch_context.py`, then copy data/interim/context/*.geojson here.

`boreholes/`: NWT Permafrost Database bulk geotechnical export (NWT Geological Survey, data owner GNWT),
downloaded 15 Nov 2026 from https://fme.geomatics.gov.nt.ca/fmeserver/apps/DownloadAllGeotech. Cite the
publications in Publications.csv (NWT Open Reports 2019-014, doi:10.46887/2019-014, and 2019-016,
doi:10.46887/2019-016). Used by src/borehole_check.py.
