"""Convenience entry point: python scripts/train.py --games 200 --simulations 100"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from agent.train_self_play import main

if __name__ == "__main__":
    main()
