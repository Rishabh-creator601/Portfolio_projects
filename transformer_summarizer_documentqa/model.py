from transformers import T5Tokenizer, T5ForConditionalGeneration,pipeline 



model_name = 't5-small'
tokenizer = T5Tokenizer.from_pretrained(model_name)
model = T5ForConditionalGeneration.from_pretrained(model_name)


qa_pipeline = pipeline("question-answering",model="csarron/mobilebert-uncased-squad-v2",
    tokenizer="csarron/mobilebert-uncased-squad-v2")



def summarize(text,length):
    inputs = tokenizer.encode("summarize: " + text, return_tensors="pt", max_length=1024, truncation=True)
    summary_ids = model.generate(inputs, max_length=length*2, min_length=length, length_penalty=2.0, num_beams=4, early_stopping=True)
    return tokenizer.decode(summary_ids[0], skip_special_tokens=True)



def answer_question(question,context):
    ans =  qa_pipeline({"question":question,"context":context})
    return ans['answer']





