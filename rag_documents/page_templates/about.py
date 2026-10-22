import streamlit as st
from config import CHAT_MODEL, EMBED_MODEL, TOP_K, CHUNK_SIZE, CHUNK_OVERLAP


# whole application as one flowchart: upload flow, question flow, outputs
FLOW_CHART = """
digraph {
    rankdir=TB; bgcolor="transparent"; nodesep=0.3; ranksep=0.35;
    node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, color="#64748b", fillcolor="#e2e8f0", fontcolor="#0f172a"];
    edge [color="#94a3b8", fontname="Helvetica", fontsize=9, fontcolor="#94a3b8"];

    subgraph cluster_upload {
        label="1. Upload (Library tab)"; fontname="Helvetica"; fontcolor="#94a3b8"; color="#94a3b8"; style="rounded,dashed";
        upload  [label="PDF / DOCX\\nfiles", fillcolor="#bfdbfe"];
        loader  [label="Loader (auto)\\nPDF: PyMuPDF\\nDOCX: python-docx"];
        chunk   [label="Chunking\\nsection_aware / recursive"];
        embed   [label="OpenAI embeddings\\n%(embed)s"];
        chroma  [label="Chroma\\nvector store", shape=cylinder, fillcolor="#c7d2fe"];
        summ    [label="Auto-summary\\n%(chat)s + Pydantic"];
        sjson   [label="Saved summaries\\n(JSON)", shape=cylinder, fillcolor="#c7d2fe"];
        upload -> loader -> chunk -> embed -> chroma;
        loader -> summ [label="full text"];
        summ -> sjson;
    }

    subgraph cluster_ask {
        label="2. Ask (Ask tab)"; fontname="Helvetica"; fontcolor="#94a3b8"; color="#94a3b8"; style="rounded,dashed";
        question [label="User question", fillcolor="#bfdbfe"];
        retr     [label="Retriever\\nhybrid: BM25 + vector (RRF)\\nor similarity"];
        context  [label="Top %(k)s chunks\\n+ paper, page, section"];
        prompt   [label="Prompt\\nresearch / general"];
        llm      [label="%(chat)s"];
        answer   [label="Answer with citations\\n[paper, p. N] + sources", fillcolor="#bbf7d0"];
        question -> retr -> context -> prompt -> llm -> answer;
    }

    subgraph cluster_out {
        label="3. Outputs"; fontname="Helvetica"; fontcolor="#94a3b8"; color="#94a3b8"; style="rounded,dashed";
        summtab [label="Summaries tab", fillcolor="#bbf7d0"];
        compare [label="Compare tab\\nside-by-side table", fillcolor="#bbf7d0"];
    }

    chroma -> retr [style=dashed, constraint=false, label="search"];
    sjson -> summtab;
    sjson -> compare;
}
""" % {"chat": CHAT_MODEL, "embed": EMBED_MODEL, "k": TOP_K}


TECH = """
| Layer | Tech | Used for |
|---|---|---|
| UI | **Streamlit** | Tabs, chat, file upload |
| LLM | **OpenAI %(chat)s** | Answers, structured paper summaries |
| Embeddings | **OpenAI %(embed)s** | Turning chunks and questions into vectors |
| RAG framework | **LangChain** | Documents, text splitter, OpenAI + Chroma wrappers, structured output |
| Vector database | **Chroma** | Stores chunks per client collection on disk |
| Keyword search | **rank-bm25** | Exact-term matching (dataset names, metrics) for hybrid search |
| Validation | **Pydantic** | Fixed summary fields: title, problem, method, dataset, results, limitations |
| File reading | **PyMuPDF**, **python-docx** | Text from PDF pages and Word headings |
| Language | **Python 3.11** | Everything |
""" % {"chat": CHAT_MODEL, "embed": EMBED_MODEL}


STEPS = """
1. **Load**: PDFs are read page by page with PyMuPDF and Word files heading by heading, so every chunk knows its paper and page.
2. **Chunk**: `section_aware` finds headings (Abstract, Method, Results ...), keeps each chunk inside one section and skips the reference list.
3. **Embed + store**: chunks are embedded with OpenAI and saved in a Chroma collection (one per client).
4. **Summarize**: each paper gets one structured summary on upload, saved so it is paid for only once.
5. **Retrieve**: `hybrid` merges BM25 keyword hits and vector hits with reciprocal rank fusion.
6. **Answer**: the LLM answers only from the retrieved chunks and cites `[paper, p. N]`; if the papers don't cover it, it says so.
"""


def show(cfg):
    st.subheader("How the application works")
    st.graphviz_chart(FLOW_CHART, width="stretch")

    st.subheader("Pipeline steps")
    st.markdown(STEPS)

    st.subheader("Tech stack")
    st.markdown(TECH)

    st.subheader("Current settings")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Chunking", cfg["chunking"])
    col2.metric("Retriever", cfg["retriever"])
    col3.metric("Prompt", cfg["prompt"])
    col4.metric("Collection", cfg["collection"])
    st.caption(f"Chunk size {CHUNK_SIZE} characters · overlap {CHUNK_OVERLAP} · top {TOP_K} chunks per question")
