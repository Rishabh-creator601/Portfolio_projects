import streamlit as st 
from page_templates import image_show,video_show



st.sidebar.title("Choose File Uploading Format")
model_choice = st.sidebar.radio(
    "Choose a model",
    ("Image","Video")
)


if model_choice == "Image":
    image_show.show()

if model_choice == "Video":
    video_show.show()