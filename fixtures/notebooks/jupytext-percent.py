# ---
# jupyter:
#   jupytext:
#     text_representation:
#       extension: .py
#       format_name: percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Sales by region
#
# Monthly totals, with $\bar{x}$ as the mean.

# %%
import pandas as pd

df = pd.DataFrame({"region": ["north", "south"], "sales": [120, 95]})

# %% tags=["summary"]
df.groupby("region")["sales"].sum()

# %% [raw]
# Not rendered: kept as raw text.
