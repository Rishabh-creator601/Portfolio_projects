import os
import streamlit as st
from config import config, CHAT_MODEL

st.set_page_config(page_title="Research Paper Assistant", page_icon="📚", layout="wide")
st.title("📚 Research Paper Assistant")
st.caption("Upload papers · ask questions with citations · summarize · compare")

if not os.getenv("OPENAI_API_KEY"):
    st.error("OPENAI_API_KEY not found. Copy `.env.example` to `.env`, add your key and restart the app.")
    st.stop()

# imported after the key check because these modules create the OpenAI client
from retriever import get_store
from page_templates import library, ask, summaries, compare, about
from page_templates.widgets import get_papers


@st.cache_resource
def load_store(collection):
    return get_store(collection)


def pick(label, key, options):
    return st.selectbox(label, options, index=options.index(config[key]))


with st.sidebar:
    st.header("⚙️ Pipeline")
    cfg = {
        "chunking": pick("Chunking", "chunking", ["section_aware", "recursive"]),
        "retriever": pick("Retriever", "retriever", ["hybrid", "similarity"]),
        "prompt": pick("Prompt", "prompt", ["research", "general"]),
        "collection": config["collection"],
    }
    st.caption(f"Model: `{CHAT_MODEL}`")

store = load_store(cfg["collection"])
papers = list(get_papers(store, cfg["collection"]))
st.sidebar.metric("Papers in collection", len(papers))

library_tab, ask_tab, summary_tab, compare_tab, about_tab = st.tabs(
    ["📁 Library", "💬 Ask", "📝 Summaries", "⚖️ Compare", "ℹ️ About"])

with library_tab:
    library.show(store, cfg)

with ask_tab:
    ask.show(store, cfg, papers)

with summary_tab:
    summaries.show(cfg, papers)

with compare_tab:
    compare.show(cfg, papers)

with about_tab:
    about.show(cfg)
