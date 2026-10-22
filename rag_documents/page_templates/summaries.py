import streamlit as st
from model import SUMMARY_FIELDS
from page_templates.widgets import get_summaries


def show(cfg, papers):
    summaries = get_summaries(cfg, papers)
    if not summaries:
        st.info("Summaries appear here after you add papers in the Library tab.")
        return

    for paper, s in summaries.items():
        with st.expander(f"📄 {s['title']}  ·  {paper}"):
            for f in SUMMARY_FIELDS[1:]:
                st.markdown(f"**{f.title()}:** {s[f]}")
