import streamlit as st
from loaders import load_file
from chunking import make_chunks, body_text
from retriever import add_chunks, list_papers, delete_paper
from model import summarize, load_summaries, save_summaries
from page_templates.widgets import get_papers


def add_files(store, cfg, files):
    existing = list_papers(store)
    summaries = load_summaries(cfg["collection"])
    progress = st.progress(0.0)

    for n, file in enumerate(files):
        progress.progress(n / len(files), text=f"Processing {file.name} ...")
        paper, pages, empty = load_file(file.getvalue(), file.name)

        if paper in existing:
            st.info(f"**{paper}** is already in the library, skipped.")
            continue
        if not pages:
            st.warning(f"**{file.name}**: no text found. It may be a scanned file (OCR is not supported yet).")
            continue
        if empty:
            st.warning(f"**{paper}**: no text on {', '.join(empty)}. Scanned or image-only pages are skipped.")

        try:
            # summary first: if the API call fails, nothing half-done is saved
            summaries[paper] = summarize(paper, body_text(pages))
            chunks = make_chunks(pages, cfg["chunking"])
            add_chunks(store, chunks)
        except Exception as e:
            st.error(f"**{paper}**: failed ({e})")
            continue

        save_summaries(cfg["collection"], summaries)
        st.success(f"**{paper}**: {len(pages)} pages · {len(chunks)} chunks · summary ready")

    progress.progress(1.0, text="Done")


def show(store, cfg):
    st.subheader("Upload papers")
    files = st.file_uploader("PDF or Word (.docx) files", type=["pdf", "docx"], accept_multiple_files=True)

    if files and st.button("Add to library", type="primary"):
        add_files(store, cfg, files)
        get_papers.clear()

    st.subheader("Library")
    papers = get_papers(store, cfg["collection"])
    if not papers:
        st.info("No papers yet. Upload a few above.")
        return

    summaries = load_summaries(cfg["collection"])
    for paper, count in papers.items():
        col1, col2 = st.columns([6, 1])
        title = summaries.get(paper, {}).get("title", "")
        col1.markdown(f"📄 **{paper}** · {count} chunks  \n<small>{title}</small>", unsafe_allow_html=True)
        if col2.button("Delete", key=f"del_{paper}"):
            delete_paper(store, paper)
            summaries.pop(paper, None)
            save_summaries(cfg["collection"], summaries)
            get_papers.clear()
            st.rerun()
