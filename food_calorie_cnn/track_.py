from ultralytics import YOLO
import cv2 ,imutils
import numpy as  np
import pandas as pd 


model =  YOLO("./models/best.pt")
class_names = model.names
color_dict = {
    "blue" : (255,0,0),
    "red": (0,0,255),
    "green": (0,255,0),
    "pink": (203,192,255),
    "cyan":(255,255,0)
}
#print("model loaded ..✔")






def detect_food_image(image_path,rect_color="red",text_Color="blue",to_rgb=True):
    image_path =  np.array(image_path.convert("RGB"))
    #sample_img =  cv2.imread(image_path)
    results =  model.predict(image_path)
    length_objs =  len(results[0].boxes)
    classes = {}
    
    for i,box in enumerate(results[0].boxes):
        cls =  int(box.cls.item())
        class_name =  class_names[cls]
        conf =  float(box.conf.item()) * 100
        
        classes[f"{class_name}_{i}"] =  f"{conf:.2f}%"
        
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        cv2.rectangle(image_path, (x1, y1), (x2, y2), color_dict[rect_color], 2)
    
        text_y = max(y1 - 10, 10)
        cv2.putText(image_path, f"{class_name} {conf:.2f}", (x1, text_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6,color_dict[text_Color], 2)
    
    if to_rgb :
        image_path = cv2.cvtColor(image_path,cv2.COLOR_BGR2RGB)
    return (image_path,classes,length_objs)







def detect_food_video(frame,height=1500,width=1500,rect_color="green",text_Color="cyan",to_rgb=True):
    
    classes = {}
            
    results  =  model(frame)
    for i,box in enumerate(results[0].boxes):
        cls =  int(box.cls.item())
        class_name =  class_names[cls]
        conf =  float(box.conf.item()) * 100
        
        classes[f"{class_name}_{i}"] =  f"{conf:.2f}%"
        
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        cv2.rectangle(frame, (x1, y1), (x2, y2), color_dict[rect_color], 2)
    
        text_y = max(y1 - 10, 10)
        cv2.putText(frame, f"{class_name} {conf:.2f}", (x1, text_y),
                cv2.FONT_HERSHEY_SIMPLEX, 2.6,color_dict[text_Color], 3)
    
    frame = imutils.resize(frame, width=width)
    if to_rgb:
        frame = cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)
    
    df = pd.DataFrame(classes.items(),columns=["Object Detected","Confidence"])
    
    return (frame,df,len(results[0].boxes))









    
