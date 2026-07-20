import re

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

open_divs = 0
for i, line in enumerate(lines):
    # Find all <div ...> (excluding <div ... />)
    divs = re.findall(r'<div([^>]*)>', line)
    for d in divs:
        if not d.endswith('/'):
            open_divs += 1
            
    open_divs -= len(re.findall(r'</div\s*>', line))
    
print(f"Final Open Divs: {open_divs}")
