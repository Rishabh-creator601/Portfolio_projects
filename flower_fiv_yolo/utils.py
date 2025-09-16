from ultralytics import YOLO
import os ,cv2
import numpy as np 
import matplotlib.pyplot as plt


model =  YOLO("flower_model.pt")  


##  for predictin purpose 
class_names = model.names
color_dict = {
    "blue" : (255,0,0),
    "red": (0,0,255),
    "green": (0,255,0),
    "pink": (203,192,255),
    "cyan":(255,255,0)
}





## detecting image designed for streamlit app but can be used in any other way
##  this function will return the image with bounding boxes and classes detected
def detect_flower_image(image_path, rect_color="red", text_Color="blue", to_rgb=True):
    
    
    if image_path.ndim == 2:  # grayscale
        image_path = cv2.cvtColor(image_path, cv2.COLOR_GRAY2RGB)
    elif image_path.shape[2] == 4:  # RGBA to RGB
        image_path = cv2.cvtColor(image_path, cv2.COLOR_RGBA2RGB)

    # Make a copy to draw on
    sample_img = image_path.copy()


    # Run prediction using the model
    results = model.predict(image_path)  # result produced by YOLO model 
    length_objs = len(results[0].boxes)  # all imp data stored in results[0].boxes
    classes = {}
    
    ## Now just draw the boxes , detect no of classes and total objects detected

    for i, box in enumerate(results[0].boxes):
        cls = int(box.cls.item())
        class_name = class_names[cls]
        conf = float(box.conf.item()) * 100

        classes[f"{class_name}_{i+1}"] = f"{conf:.2f}%"

        x1, y1, x2, y2 = map(int, box.xyxy[0]) # coordinates of the bounding box
        cv2.rectangle(sample_img, (x1, y1), (x2, y2), color_dict[rect_color], 2)

        text_y = max(y1 - 10, 10)
        cv2.putText(sample_img, f"{class_name} {conf:.2f}%", (x1, text_y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_dict[text_Color], 2)

    if to_rgb:
        sample_img = cv2.cvtColor(sample_img, cv2.COLOR_BGR2RGB)

    return sample_img, classes, length_objs


