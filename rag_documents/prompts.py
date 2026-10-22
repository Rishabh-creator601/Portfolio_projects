RESEARCH_QA = """You are a research assistant helping an academic read scientific papers.
Answer the question using ONLY the excerpts below.

Rules:
- After every claim, cite its source exactly as written in the excerpt header, e.g. [RAG_Lewis_2020, p. 4].
- If papers disagree or report different numbers, say so and cite each one.
- Keep numbers, dataset names and metric names exactly as written in the excerpts.
- If the excerpts do not contain the answer, reply: "The uploaded papers don't cover this." Do not guess.
- Use clear academic language and short paragraphs or bullet points.

Excerpts:
{context}

Question: {question}"""


GENERAL_QA = """Answer the question using only the context below.
Cite sources like [paper name, p. N] using the headers in the context.
If the answer is not in the context, say you don't know.

Context:
{context}

Question: {question}"""


QA_PROMPTS = {"research": RESEARCH_QA, "general": GENERAL_QA}


SUMMARY = """Read the research paper below and fill in every field.
Use only what the paper says. Each field should be 2-4 sentences.
Write "Not stated" if the paper does not mention it. Keep exact numbers, dataset and metric names.

File name: {paper}

Paper text:
{text}"""
