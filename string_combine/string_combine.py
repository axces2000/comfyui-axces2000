"""
String Combine Node for ComfyUI
Concatenates up to 10 string inputs into a single output, preserving all
content exactly as-is (no trimming, no separators added).
Unconnected optional inputs are simply ignored.
"""


class StringCombineNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "string_1":  ("STRING", {"forceInput": True}),
                "string_2":  ("STRING", {"forceInput": True}),
                "string_3":  ("STRING", {"forceInput": True}),
                "string_4":  ("STRING", {"forceInput": True}),
                "string_5":  ("STRING", {"forceInput": True}),
                "string_6":  ("STRING", {"forceInput": True}),
                "string_7":  ("STRING", {"forceInput": True}),
                "string_8":  ("STRING", {"forceInput": True}),
                "string_9":  ("STRING", {"forceInput": True}),
                "string_10": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES  = ("STRING",)
    RETURN_NAMES  = ("combined",)
    FUNCTION      = "combine"
    CATEGORY      = "text"
    OUTPUT_NODE   = False

    def combine(self,
                string_1=None,  string_2=None,  string_3=None,
                string_4=None,  string_5=None,  string_6=None,
                string_7=None,  string_8=None,  string_9=None,
                string_10=None):

        parts = [
            string_1, string_2, string_3, string_4,  string_5,
            string_6, string_7, string_8, string_9,  string_10,
        ]
        result = "".join(s for s in parts if s is not None)
        return (result,)


NODE_CLASS_MAPPINGS        = {"StringCombine": StringCombineNode}
NODE_DISPLAY_NAME_MAPPINGS = {"StringCombine": "🔗 String Combine"}
