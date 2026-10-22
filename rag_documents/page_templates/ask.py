import streamlit as st
from model import ask


def show_sources(sources):
    with st.expander(f"Sources ({len(sources)})"):
        for s in sources:
            section = f" · {s['section']}" if s["section"] else ""
            st.markdown(f"**{s['paper']}, {s['loc']}**{section}")
            st.caption(s["text"])


def show(store, cfg, papers):
    key = f"messages_{cfg['collection']}"
    if key not in st.session_state:
        st.session_state[key] = []
    messages = st.session_state[key]

    selected = st.multiselect("Search in (leave empty for all papers)", papers)

    for msg in messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            if msg.get("sources"):
                show_sources(msg["sources"])

    question = st.chat_input("Ask a question across your papers")
    if question:
        with st.chat_message("user"):
            st.markdown(question)

        with st.chat_message("assistant"):
            with st.spinner("Searching papers ..."):
                answer, docs = ask(store, question, cfg, selected)
            sources = [{"paper": d.metadata["paper"], "loc": d.metadata["loc"],
                        "section": d.metadata.get("section", ""), "text": d.page_content} for d in docs]
            st.markdown(answer)
            if sources:
                show_sources(sources)

        messages.append({"role": "user", "content": question})
        messages.append({"role": "assistant", "content": answer, "sources": sources})

    if messages:
        st.divider()
        if st.button("Clear chat"):
            st.session_state[key] = []
            st.rerun()
