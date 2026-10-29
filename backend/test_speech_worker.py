import unittest
from speech_worker import validate_words,local_directory,diagnostics

class WorkerContractTests(unittest.TestCase):
    def test_hinglish_is_preserved_and_missing_alignment_is_explicit(self):
        words,missing=validate_words([{"word":"AI","start":.1,"end":.4},{"word":"सुरक्षा","start":.5,"end":.9},{"word":"mein"}],2)
        self.assertEqual([w["text"] for w in words],["AI","सुरक्षा"])
        self.assertEqual(missing,["mein"])

    def test_overlap_nan_and_zero_duration_are_not_invented_as_valid_alignment(self):
        words,missing=validate_words([{"word":"a","start":0,"end":1},{"word":"b","start":.5,"end":1.2},{"word":"c","start":float('nan'),"end":2},{"word":"d","start":2,"end":2}],3)
        self.assertEqual(len(words),1)
        self.assertEqual(missing,["b","c","d"])

    def test_models_require_explicit_existing_local_directories(self):
        with self.assertRaises(ValueError):
            local_directory("model-name-from-network","ASR")

    def test_diagnostics_report_actual_module_availability(self):
        result=diagnostics()
        self.assertIn("faster_whisper",result["modules"])
        self.assertEqual(result["available"],result["pythonCompatible"] and all(m["available"] for m in result["modules"].values()))

if __name__=='__main__':
    unittest.main()
