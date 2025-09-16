import streamlit as st 
from pages_templates import image_show,video_show

st.sidebar.title("Face Mask Detection APP")




with st.sidebar.container():
    st.header("Choose Uploading format")
    format_ = st.radio("Choose One",["Image","Video"])
    
    
if format_ == "Image":
    
    image_show.show()


elif format_ == "Video":
    video_show.show()


    