"""Print the internal tree of a NISAR HDF5 file so you can fill the dataset paths in config.yaml.
Usage: python src/inspect_h5.py data/raw/<file>.h5
"""
import sys, h5py

def show(name, obj):
    if isinstance(obj, h5py.Dataset):
        print(f"{name}  shape={obj.shape} dtype={obj.dtype}")

with h5py.File(sys.argv[1], "r") as f:
    f.visititems(show)
