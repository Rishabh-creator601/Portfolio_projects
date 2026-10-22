import re
from rank_bm25 import BM25Okapi
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from config import EMBED_MODEL, STORAGE_DIR


def get_store(collection):
    # one Chroma collection per client, saved on disk
    return Chroma(collection_name=collection,
                  embedding_function=OpenAIEmbeddings(model=EMBED_MODEL),
                  persist_directory=f"{STORAGE_DIR}/chroma")


def add_chunks(store, chunks):
    ids = [f"{c.metadata['paper']}-{i}" for i, c in enumerate(chunks)]
    store.add_documents(chunks, ids=ids)


def list_papers(store):
    metas = store.get(include=["metadatas"])["metadatas"]
    counts = {}
    for m in metas:
        counts[m["paper"]] = counts.get(m["paper"], 0) + 1
    return dict(sorted(counts.items()))


def delete_paper(store, paper):
    ids = store.get(where={"paper": paper})["ids"]
    if ids:
        store.delete(ids=ids)


def paper_filter(papers):
    if not papers:
        return None
    return {"paper": papers[0]} if len(papers) == 1 else {"paper": {"$in": papers}}


def similarity_search(store, query, k, papers=None):
    return store.similarity_search(query, k=k, filter=paper_filter(papers))


def tokenize(text):
    return re.findall(r"\w+", text.lower())


def keyword_search(store, query, k, papers=None):
    # BM25 over the stored chunks (fine for a few thousand chunks)
    data = store.get(where=paper_filter(papers), include=["documents", "metadatas"])
    docs = [Document(page_content=t, metadata=m) for t, m in zip(data["documents"], data["metadatas"])]
    if not docs:
        return []
    scores = BM25Okapi([tokenize(d.page_content) for d in docs]).get_scores(tokenize(query))
    best = sorted(range(len(docs)), key=lambda i: scores[i], reverse=True)[:k]
    return [docs[i] for i in best]


def hybrid_search(store, query, k, papers=None):
    # reciprocal rank fusion: chunks ranked high by either search float to the top
    fused = {}
    for hits in (similarity_search(store, query, k * 2, papers), keyword_search(store, query, k * 2, papers)):
        for rank, doc in enumerate(hits):
            key = (doc.metadata["paper"], doc.metadata["page"], doc.page_content[:80])
            score = fused.get(key, (0, doc))[0] + 1 / (60 + rank)
            fused[key] = (score, doc)
    ranked = sorted(fused.values(), key=lambda x: x[0], reverse=True)
    return [doc for _, doc in ranked[:k]]


RETRIEVERS = {"similarity": similarity_search, "hybrid": hybrid_search}


def retrieve(store, query, k, method="hybrid", papers=None):
    return RETRIEVERS[method](store, query, k, papers)
