import pandas as pd
import streamlit as st
from model import SUMMARY_FIELDS
from page_templates.widgets import get_summaries


def show(cfg, papers):
    summaries = get_summaries(cfg, papers)
    if len(summaries) < 2:
        st.info("Add at least 2 papers to compare them.")
        return

    chosen = st.multiselect("Papers to compare", list(summaries), default=list(summaries)[:3])
    if len(chosen) < 2:
        st.info("Pick at least 2 papers.")
        return

    # built from the saved summaries, so comparing costs no API calls
    table = pd.DataFrame({p: [summaries[p][f] for f in SUMMARY_FIELDS] for p in chosen},
                         index=[f.title() for f in SUMMARY_FIELDS])
    st.table(table)
