#!/usr/bin/env python3
"""Convert MS Project .mpp file to CSV using mpxj."""

import sys
import csv
import os
import glob

import jpype
import mpxj

# Add all mpxj JARs to classpath before starting JVM
jar_dir = os.path.join(os.path.dirname(mpxj.__file__), "lib")
jars = glob.glob(os.path.join(jar_dir, "*.jar"))
jpype.startJVM(classpath=jars, convertStrings=True)

from org.mpxj.reader import UniversalProjectReader  # type: ignore

def fmt_date(d):
    if d is None:
        return ""
    s = str(d)
    return s[:10]

def main(inp, out):
    reader = UniversalProjectReader()
    project = reader.read(inp)
    tasks = project.getTasks()
    print(f"Total tasks: {tasks.size()}", file=sys.stderr)

    fieldnames = [
        "ID", "Outline Number", "Outline Level", "Task Name",
        "Baseline Start", "Baseline Finish",
        "Actual Start", "Actual Finish",
        "% Complete", "Predecessors",
        "Duration Days", "Resource Names",
    ]
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(fieldnames)
        count = 0
        for t in tasks:
            try:
                if t.getName() is None or t.getName() == "":
                    continue
                outline_number = t.getOutlineNumber() or ""
                outline_level = t.getOutlineLevel() or 0
                name = t.getName() or ""
                baseline_start = fmt_date(t.getBaselineStart())
                baseline_finish = fmt_date(t.getBaselineFinish())
                actual_start = fmt_date(t.getActualStart())
                actual_finish = fmt_date(t.getActualFinish())
                pct_obj = t.getPercentageComplete()
                pct = float(str(pct_obj)) if pct_obj else 0
                preds = t.getPredecessors()
                pred_str = ""
                if preds:
                    pred_ids = []
                    for r in preds:
                        try:
                            tt = r.getTargetTask()
                            if tt:
                                pred_ids.append(str(tt.getID()))
                        except Exception:
                            pass
                    pred_str = ",".join(pred_ids)
                dur = t.getDuration()
                dur_str = str(dur) if dur else ""
                resources = t.getResourceAssignments()
                res_names = []
                if resources:
                    for ra in resources:
                        r = ra.getResource()
                        if r and r.getName():
                            res_names.append(r.getName())
                w.writerow([
                    t.getID(),
                    outline_number, outline_level, name,
                    baseline_start, baseline_finish,
                    actual_start, actual_finish,
                    pct, pred_str, dur_str, "; ".join(res_names),
                ])
                count += 1
            except Exception as e:
                print(f"Skipping task: {e}", file=sys.stderr)
        print(f"Wrote {count} tasks", file=sys.stderr)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
