

import streamlit as st 
from model import summarize,answer_question
import io ,easyocr
from pypdf import PdfReader
from  PIL import Image
from streamlit_pdf_viewer import pdf_viewer
import numpy as np 



min_length =  100 
st.title("Transformer Tools (Hugging Face) 🤗 ")




def extract_text(image):
    reader = easyocr.Reader(['en'], gpu=False)
    text_detections = reader.readtext(image)
    final_text = ""
    for bbox, text, confidence in text_detections:
        final_text += text + " "
    return final_text


with st.sidebar:
    st.write("**Model Paramters :**")
    
    
    # Model paramters 
    min_length =  st.number_input("Enter Min Length : ",min_value=100,max_value=500,step=50)
    
    
    st.markdown("**Choose File Type :**")
    file_type = st.radio(
    "Choose file type:",
    ("TXT", "PDF","Images") ,index=0)
    
    if file_type ==  "PDF":
        pg_no =  st.number_input("Enter PgNo :",min_value=0) |  0 
        
        
    
    type_map = {
    "TXT": [".txt"],
    "PDF": [".pdf"],
    "Images":[".png",".jpg"]
    }



string_data = None 

holder  = st.empty()
text_data = holder.file_uploader(f"Choose a  {file_type} file", type=type_map[file_type],key="file")

if text_data is not None :
    
    if file_type == "TXT":
        stringio = io.StringIO(text_data.getvalue().decode("utf-8"))
        string_data = stringio.read()
    
    if file_type == "PDF":
    
        pdf_file =  PdfReader(text_data).pages[pg_no]
        string_data =  pdf_file.extract_text()
        pdf_viewer(input=text_data.getvalue(),height=300)
    
    if file_type == "Images":
        image =  np.array(Image.open(io.BytesIO(text_data.read())))
        string_data =  extract_text(image)
        st.image(image,caption="Uploaded Image")
        
        
    st.markdown("## Text I Got !")
    st.write(string_data)
    
    

summarizer_tab , document_qa =  st.tabs(["Text Summarizer","Document Q/A "])

with summarizer_tab:
    
    if string_data is not None :
                  
        st.markdown("## Your Summary ")
        summarized_text =  summarize(string_data,min_length)
        st.write(summarized_text)
        
        

with document_qa:
    # display history
    if "messages" not in st.session_state:
        st.session_state.messages = []



    # taking user input and only act if prompt provided
    prompt = st.chat_input("Ask a question about the document:")
    if prompt :
        # display user message
        with st.chat_message("user"):
            st.markdown(prompt)

        # add to history (INSIDE the if)
        st.session_state.messages.append({"role": "user", "content": prompt})

        # only call QA if we have context
        if not string_data:
            response = "No document uploaded. Please upload a file first."
        else:
            ans = answer_question(question=prompt, context=string_data)
            response = f"{ans}"

        with st.chat_message("assistant"):
            st.markdown(response)

        st.session_state.messages.append({"role": "assistant", "content": response})
    
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
    