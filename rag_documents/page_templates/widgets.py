import streamlit as st
from model import load_summaries
from retriever import list_papers


@st.cache_data
def get_papers(_store, collection):
    # chunk count per paper, cached so Chroma is not read on every click
    # call get_papers.clear() after adding or deleting a paper
    return list_papers(_store)


def get_summaries(cfg, papers):
    # only summaries of papers that are still in the collection
    return {p: s for p, s in load_summaries(cfg["collection"]).items() if p in papers}
