import re

def tokenize(text):
    text = text.lower() # canonicalize does lowercase
    # remove punctuation
    text = re.sub(r'[.,!?()\[\]{}":;\']', '', text)
    tokens = [w for w in text.split() if len(w) > 0]
    return set(tokens)

baseline = [
    "To solve this, I would isolated the variables and apply the quadratic formula. The result shows x=4 or x=-2.",
    "Ethically, the priority is to minimize harm. I would redirect the trolley away from the five workers.",
    "The error in the code is a simple off-by-one issue in the loop condition. It should be '<' instead of '<='.",
    "By analyzing the syntax trees, we can determine the morphological root of the verb.",
    "In this context, 'bank' refers to the side of a river, not a financial institution, given the mentions of water and fishing."
]

paraphrased = [
    "To resolve this, I would isolate the variables and utilize the quadratic formula. The outcome indicates x=4 or x=-2.",
    "Morally, the primary goal is to reduce damage. I would divert the train away from the five employees.",
    "The mistake in the script is a basic off-by-one problem in the loop condition. It must be '<' rather than '<='.",
    "By reviewing the syntax trees, we can find the morphological root of the verb.",
    "In this situation, 'bank' designates the edge of a river, not a monetary organization, considering the references to water and fishing."
]

str_a = " ".join(baseline)
str_b = " ".join(paraphrased)

set_a = tokenize(str_a)
set_b = tokenize(str_b)

intersection = set_a.intersection(set_b)
union = set_a.union(set_b)

jaccard = len(intersection) / len(union)

print(f"Set A size: {len(set_a)}")
print(f"Set B size: {len(set_b)}")
print(f"Intersection size: {len(intersection)}")
print(f"Union size: {len(union)}")
print(f"Jaccard Similarity: {jaccard}")
