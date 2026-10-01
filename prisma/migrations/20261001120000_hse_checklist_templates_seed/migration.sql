-- HSE Inspection Checklist template seed · Shraddha 2026-10-01.
--
-- Seeds the 5 safety-side checklist templates whose source PDFs sit in
-- the "Work Permit and HSE Checklist" zip Shraddha sent on 2026-09-30:
--
--   1. Checklist - Power Tools        · 6001-EHS-SDF-063 · 15 items
--   2. Checklist - PPE                 · 6001-EHS-SDF-062 · 10 items
--   3. Checklist - Scaffolding         · 6001-EHS-SDF-026 · 20 items
--   4. Checklist - Concrete            · 6001-EHS-SDF-039 · 29 items
--   5. P&M Checklist - Vehicular       · TE-EHS-CL-PM-VEHM · 42 items / 6 sections
--
-- The vehicular checklist is the one that exercises section grouping
-- (General / Documents / Dump Truck & Transit Mixers / JCB / Tractor /
-- Excavator) — the exact pattern Colab shows via PRE CHECKS /
-- POST CHECKS headers that we wired up in the previous commit
-- (InspectionForm, section header renderer).
--
-- Each template is created with module='SAFETY' so Girish/Abhishek see
-- it when they tap Raise HSE Checklist and Nagarjuna does NOT see it
-- when he taps Raise WIR (templates filter on user module scope in
-- /api/inspection-templates).
--
-- Idempotent via `ON CONFLICT ("code") DO NOTHING` on the template,
-- which short-circuits the whole insert for that code; items are keyed
-- by their templateId+seq combination and bail the same way, so a
-- re-run after a partial deploy is safe.

INSERT INTO "InspectionTemplate" ("id", "code", "name", "activity", "module", "orderIndex", "active", "createdAt", "updatedAt")
VALUES
  ('tpl_hse_power_tools', 'HSE-POWER-TOOLS',    'CHECKLIST FOR POWER TOOLS - EHS INSPECTION', 'EHS Inspection', 'SAFETY', 100, true, NOW(), NOW()),
  ('tpl_hse_ppe',         'HSE-PPE',             'PPE CHECKLIST',                              'EHS Inspection', 'SAFETY', 101, true, NOW(), NOW()),
  ('tpl_hse_scaffolding', 'HSE-SCAFFOLDING',     'INSPECTION CHECKLIST - SCAFFOLDING',         'EHS Inspection', 'SAFETY', 102, true, NOW(), NOW()),
  ('tpl_hse_concrete',    'HSE-CONCRETE',        'INSPECTION CHECKLIST - CONCRETE',            'EHS Inspection', 'SAFETY', 103, true, NOW(), NOW()),
  ('tpl_hse_vehicular',   'HSE-PM-VEHICULAR',    'P&M CHECKLIST - SITE VEHICULAR MANAGEMENT',  'P&M Inspection', 'SAFETY', 104, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Power Tools · 15 items · ungrouped (section = NULL)
-- Source: Checklist - Power Tools.pdf (6001-EHS-SDF-063 R0 10.02.2020)
-- ---------------------------------------------------------------------------
INSERT INTO "InspectionTemplateItem" ("id", "templateId", "seq", "section", "description") VALUES
  ('tpl_item_pt_01', 'tpl_hse_power_tools',  1, NULL, 'Check for any abnormal noise and vibration?'),
  ('tpl_item_pt_02', 'tpl_hse_power_tools',  2, NULL, 'Are all electrical cables and connections are in good condition?'),
  ('tpl_item_pt_03', 'tpl_hse_power_tools',  3, NULL, 'Industrial socket used for connecting the wires?'),
  ('tpl_item_pt_04', 'tpl_hse_power_tools',  4, NULL, 'Are operators are trainined.?'),
  ('tpl_item_pt_05', 'tpl_hse_power_tools',  5, NULL, 'Is it ensured that only double insulated tools are used?'),
  ('tpl_item_pt_06', 'tpl_hse_power_tools',  6, NULL, 'Is guard provided for rotating parts?'),
  ('tpl_item_pt_07', 'tpl_hse_power_tools',  7, NULL, 'Ensure power tool on/off switch in good condition?'),
  ('tpl_item_pt_08', 'tpl_hse_power_tools',  8, NULL, 'Are all portable electrical tools tested by competent person for its proper functioning before put to use?'),
  ('tpl_item_pt_09', 'tpl_hse_power_tools',  9, NULL, 'Is periodic maintenance of power tools done and records maintained?'),
  ('tpl_item_pt_10', 'tpl_hse_power_tools', 10, NULL, 'Is it ensured that the cables are without joints and in sound condition?'),
  ('tpl_item_pt_11', 'tpl_hse_power_tools', 11, NULL, 'Are all grinding machines supplied with sufficient power to maintain the spindle speed at safe levels under all conditions of normal operation?'),
  ('tpl_item_pt_12', 'tpl_hse_power_tools', 12, NULL, 'Is it ensured that all grinding machines are marked with the maximum working speed of the spindles?'),
  ('tpl_item_pt_13', 'tpl_hse_power_tools', 13, NULL, 'Do movable guards operate freely?'),
  ('tpl_item_pt_14', 'tpl_hse_power_tools', 14, NULL, 'Is the ground prong in good condition (for three-wire grounded tools)?'),
  ('tpl_item_pt_15', 'tpl_hse_power_tools', 15, NULL, 'Are there any visible cracks or defects in the tool housing?')
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- PPE · 10 items · ungrouped
-- Source: Checklist - PPE.pdf (6001-EHS-SDF-062 R0 10.02.2020)
-- ---------------------------------------------------------------------------
INSERT INTO "InspectionTemplateItem" ("id", "templateId", "seq", "section", "description") VALUES
  ('tpl_item_ppe_01', 'tpl_hse_ppe',  1, NULL, 'Is suitable protective clothing being worn?'),
  ('tpl_item_ppe_02', 'tpl_hse_ppe',  2, NULL, 'Is eye protection being used?'),
  ('tpl_item_ppe_03', 'tpl_hse_ppe',  3, NULL, 'Is hearing protection being used?'),
  ('tpl_item_ppe_04', 'tpl_hse_ppe',  4, NULL, 'Is hand protection being used?'),
  ('tpl_item_ppe_05', 'tpl_hse_ppe',  5, NULL, 'Is protective equipment in good condition?'),
  ('tpl_item_ppe_06', 'tpl_hse_ppe',  6, NULL, 'Is protection suitable for work performed?'),
  ('tpl_item_ppe_07', 'tpl_hse_ppe',  7, NULL, 'Do the workers wear Helmet in such a way to protect their head?'),
  ('tpl_item_ppe_08', 'tpl_hse_ppe',  8, NULL, 'Do the workers using appropriate Footwear with steel toe?'),
  ('tpl_item_ppe_09', 'tpl_hse_ppe',  9, NULL, 'Are the helpers also using proper PPE''s?'),
  ('tpl_item_ppe_10', 'tpl_hse_ppe', 10, NULL, 'Is there any need for Safety goggles for the work being done? If so, are they using appropriate equipment?')
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Scaffolding · 20 items · ungrouped
-- Source: Checklist - Scaffolding.pdf (6001-EHS-SDF-026 R0 10.02.2020)
-- ---------------------------------------------------------------------------
INSERT INTO "InspectionTemplateItem" ("id", "templateId", "seq", "section", "description") VALUES
  ('tpl_item_sc_01', 'tpl_hse_scaffolding',  1, NULL, 'Is the work area secured against unauthorized entry?'),
  ('tpl_item_sc_02', 'tpl_hse_scaffolding',  2, NULL, 'Is toe board provided and in good condition?'),
  ('tpl_item_sc_03', 'tpl_hse_scaffolding',  3, NULL, 'Proper access and egress provided?'),
  ('tpl_item_sc_04', 'tpl_hse_scaffolding',  4, NULL, 'All the materials Stand, brace, base plate, sole boards, platform plank/MS challis, toe board are in good condition?'),
  ('tpl_item_sc_05', 'tpl_hse_scaffolding',  5, NULL, 'Check for type of surface uneven surface / filled area and any chances for settlement'),
  ('tpl_item_sc_06', 'tpl_hse_scaffolding',  6, NULL, 'Any defects observed in scaffolding? (write in remarks)'),
  ('tpl_item_sc_07', 'tpl_hse_scaffolding',  7, NULL, 'All the ties are checked and are in good condition?'),
  ('tpl_item_sc_08', 'tpl_hse_scaffolding',  8, NULL, 'Are all connections of scaffolding bracings in good condition?'),
  ('tpl_item_sc_09', 'tpl_hse_scaffolding',  9, NULL, 'Are diagonal bracings provided and it is in good condition?'),
  ('tpl_item_sc_10', 'tpl_hse_scaffolding', 10, NULL, 'Are transverse diagonal bracing provided and it is in good condition?'),
  ('tpl_item_sc_11', 'tpl_hse_scaffolding', 11, NULL, 'Clearance maintained between scaffolds and power lines?'),
  ('tpl_item_sc_12', 'tpl_hse_scaffolding', 12, NULL, 'Are scaffolding inner and outer legs (stand) are connected to the tie to support?'),
  ('tpl_item_sc_13', 'tpl_hse_scaffolding', 13, NULL, 'Are scaffolding ties provided as per standard?'),
  ('tpl_item_sc_14', 'tpl_hse_scaffolding', 14, NULL, 'Found any damaged component in the scaffolding?'),
  ('tpl_item_sc_15', 'tpl_hse_scaffolding', 15, NULL, 'Is the scaffolding maintained in plumb vertical? (no swing and no sway)'),
  ('tpl_item_sc_16', 'tpl_hse_scaffolding', 16, NULL, 'Are scaffolding (Excluding work platforms) earthed if erected on concreted slab properly?'),
  ('tpl_item_sc_17', 'tpl_hse_scaffolding', 17, NULL, 'If mobile scaffolding, does it have locking arrangements against movement?'),
  ('tpl_item_sc_18', 'tpl_hse_scaffolding', 18, NULL, 'Are hand rail, mid rail, toe board provided in case of mobile scaffold?'),
  ('tpl_item_sc_19', 'tpl_hse_scaffolding', 19, NULL, 'Is cantilever provided scaffolding erected below 4 mtr height 3 mtr width?'),
  ('tpl_item_sc_20', 'tpl_hse_scaffolding', 20, NULL, 'Are scaffolding ties provided erected above 4mtr height and below 3mtr width?')
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Concrete · 29 items · ungrouped
-- Source: Checklist - Concrete.pdf (6001-EHS-SDF-039 R0 10.02.2020)
-- ---------------------------------------------------------------------------
INSERT INTO "InspectionTemplateItem" ("id", "templateId", "seq", "section", "description") VALUES
  ('tpl_item_co_01', 'tpl_hse_concrete',  1, NULL, 'Is concreting plan available? (If more than 100 M³)'),
  ('tpl_item_co_02', 'tpl_hse_concrete',  2, NULL, 'Are every one involved in concrete work has undergone concreting work related hazard training?'),
  ('tpl_item_co_03', 'tpl_hse_concrete',  3, NULL, 'Are all the required legal documents (pump inspection report, vehicle documents etc.,) are available?'),
  ('tpl_item_co_04', 'tpl_hse_concrete',  4, NULL, 'Are all the portable electrical machines are in good condition'),
  ('tpl_item_co_05', 'tpl_hse_concrete',  5, NULL, 'Pump is in good condition?'),
  ('tpl_item_co_06', 'tpl_hse_concrete',  6, NULL, 'Has pipe thickness testing been performed regularly?'),
  ('tpl_item_co_07', 'tpl_hse_concrete',  7, NULL, 'Check all the guards?'),
  ('tpl_item_co_08', 'tpl_hse_concrete',  8, NULL, 'Check for all the connections, fittings, anchors, supports and supporting structures.'),
  ('tpl_item_co_09', 'tpl_hse_concrete',  9, NULL, 'Check the pipe lines, clamps for any leakage.'),
  ('tpl_item_co_10', 'tpl_hse_concrete', 10, NULL, 'Are appropriate PPEs provided?'),
  ('tpl_item_co_11', 'tpl_hse_concrete', 11, NULL, 'Ensure the signal man and pump operators competency and required communication devices available.'),
  ('tpl_item_co_12', 'tpl_hse_concrete', 12, NULL, 'Check wear & tear of tires & treads'),
  ('tpl_item_co_13', 'tpl_hse_concrete', 13, NULL, 'Are pump chair provided in the slab and horizontal routing?'),
  ('tpl_item_co_14', 'tpl_hse_concrete', 14, NULL, 'Are wheel stopper provided and outriggers be securely locked?'),
  ('tpl_item_co_15', 'tpl_hse_concrete', 15, NULL, 'Is it ensured that the concreting area is totally barricaded?'),
  ('tpl_item_co_16', 'tpl_hse_concrete', 16, NULL, 'Is it ensured that no pipe line in concrete pumping system is attached to any temporary structure such as scaffolds?'),
  ('tpl_item_co_17', 'tpl_hse_concrete', 17, NULL, 'Is proper illumination provided Minimum of 200 lux?'),
  ('tpl_item_co_18', 'tpl_hse_concrete', 18, NULL, 'All electrical wires are provided/routed at safe level?'),
  ('tpl_item_co_19', 'tpl_hse_concrete', 19, NULL, 'Provided proper access on the slab reinforcement?'),
  ('tpl_item_co_20', 'tpl_hse_concrete', 20, NULL, 'Has proper access provided to the work area.'),
  ('tpl_item_co_21', 'tpl_hse_concrete', 21, NULL, 'Is vibrator inspected and is in good condition.'),
  ('tpl_item_co_22', 'tpl_hse_concrete', 22, NULL, 'Are all openings closed at concreting level?'),
  ('tpl_item_co_23', 'tpl_hse_concrete', 23, NULL, 'Ensure first aid kit available at work location (Eye wash, and general first aid kit as mentioned in BOCW act.,)'),
  ('tpl_item_co_24', 'tpl_hse_concrete', 24, NULL, 'Ensure no cooking and campfire allowed inside the site.'),
  ('tpl_item_co_25', 'tpl_hse_concrete', 25, NULL, 'Ensure required materials available before concrete (Tarpaulin, umbrella, raincoat, appropriate shelter)'),
  ('tpl_item_co_26', 'tpl_hse_concrete', 26, NULL, 'Are required signages provided?'),
  ('tpl_item_co_27', 'tpl_hse_concrete', 27, NULL, 'Ensure that the workers are not in influence of alcohol or any other drugs.'),
  ('tpl_item_co_28', 'tpl_hse_concrete', 28, NULL, 'Are signal men provided?'),
  ('tpl_item_co_29', 'tpl_hse_concrete', 29, NULL, 'Is applicable Permit to work (PTW) taken?')
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- P&M · Vehicular · 42 items grouped into 6 sections
-- Source: P&M Checklist - Vehicular Checklist.pdf
-- Sections mirror the PDF: General Points / Documents / Dump Truck &
-- Transit Mixers / JCB / Tractor / Excavator. This is the template
-- that exercises the InspectionForm section-header renderer wired up
-- in the previous commit — picking it from the Raise HSE Checklist
-- flow should visibly group the items under dark headers.
-- ---------------------------------------------------------------------------
INSERT INTO "InspectionTemplateItem" ("id", "templateId", "seq", "section", "description") VALUES
  ('tpl_item_veh_01', 'tpl_hse_vehicular',  1, 'GENERAL POINTS', 'Are the front & reverse horns in working condition'),
  ('tpl_item_veh_02', 'tpl_hse_vehicular',  2, 'GENERAL POINTS', 'Are the head & tail lamps (for working at night / adverse weather situation) & indicators in working condition'),
  ('tpl_item_veh_03', 'tpl_hse_vehicular',  3, 'GENERAL POINTS', 'Is any diesel, oil and grease spillage observed'),
  ('tpl_item_veh_04', 'tpl_hse_vehicular',  4, 'GENERAL POINTS', 'Are the breaks, clutch and accelerator in working condition'),
  ('tpl_item_veh_05', 'tpl_hse_vehicular',  5, 'GENERAL POINTS', 'Is any damage in tyres observed (crack, cut) and do they have sufficient air pressure'),
  ('tpl_item_veh_06', 'tpl_hse_vehicular',  6, 'GENERAL POINTS', 'Are the windscreen & wipers undamaged / in working condition'),
  ('tpl_item_veh_07', 'tpl_hse_vehicular',  7, 'GENERAL POINTS', 'Are the side mirrors for vehicles (except excavators) available, clean, undamaged and in correct position'),
  ('tpl_item_veh_08', 'tpl_hse_vehicular',  8, 'GENERAL POINTS', 'Is the registration number plate (dump trucks, tractor & transit mixers) visible, undamaged and is present on the front & back side of the vehicle'),
  ('tpl_item_veh_09', 'tpl_hse_vehicular',  9, 'GENERAL POINTS', 'Is the hydraulic oil level (max / min) indicator in working condition'),
  ('tpl_item_veh_10', 'tpl_hse_vehicular', 10, 'GENERAL POINTS', 'Is a portable fire extinguisher available in the operator''s / driver''s cabin'),
  ('tpl_item_veh_11', 'tpl_hse_vehicular', 11, 'GENERAL POINTS', 'Are back stoppers provided for all heavy vehicles'),
  ('tpl_item_veh_12', 'tpl_hse_vehicular', 12, 'GENERAL POINTS', 'Is vehicle management training carried out for drivers / operators & are training records maintained'),
  ('tpl_item_veh_13', 'tpl_hse_vehicular', 13, 'DOCUMENTS',       'Is a valid vehicle insurance & P.U.C available & next due date is mentioned'),
  ('tpl_item_veh_14', 'tpl_hse_vehicular', 14, 'DOCUMENTS',       'Is a valid operator''s license (heavy duty) / driver''s license / experience certificate (for excavator operator) available'),
  ('tpl_item_veh_15', 'tpl_hse_vehicular', 15, 'DOCUMENTS',       'Is vehicular fitness certificate available'),
  ('tpl_item_veh_16', 'tpl_hse_vehicular', 16, 'DUMP TRUCK & TRANSIT MIXERS', 'Is any air leak in the air tank observed'),
  ('tpl_item_veh_17', 'tpl_hse_vehicular', 17, 'DUMP TRUCK & TRANSIT MIXERS', 'Is the rear view mirror available without damage'),
  ('tpl_item_veh_18', 'tpl_hse_vehicular', 18, 'DUMP TRUCK & TRANSIT MIXERS', 'Are the emergency hand brakes in proper working condition'),
  ('tpl_item_veh_19', 'tpl_hse_vehicular', 19, 'DUMP TRUCK & TRANSIT MIXERS', 'Are the carriers for dump truck in good condition'),
  ('tpl_item_veh_20', 'tpl_hse_vehicular', 20, 'DUMP TRUCK & TRANSIT MIXERS', 'Is the seat belt available & in good condition'),
  ('tpl_item_veh_21', 'tpl_hse_vehicular', 21, 'DUMP TRUCK & TRANSIT MIXERS', 'Is in-built ladder available for transit mixers & is it in good condition'),
  ('tpl_item_veh_22', 'tpl_hse_vehicular', 22, 'DUMP TRUCK & TRANSIT MIXERS', 'Are rotatory parts of secondary engine (for Transit Mixers) covered & guarded'),
  ('tpl_item_veh_23', 'tpl_hse_vehicular', 23, 'JCB',             'Are both front & reverse horns in working condition'),
  ('tpl_item_veh_24', 'tpl_hse_vehicular', 24, 'JCB',             'Is any sign of oil leakage in hydraulic systems observed'),
  ('tpl_item_veh_25', 'tpl_hse_vehicular', 25, 'JCB',             'Are the bolts and cotter pins of bucket intact and in safe condition'),
  ('tpl_item_veh_26', 'tpl_hse_vehicular', 26, 'JCB',             'Are the boom & the arm without damage / cut / crack'),
  ('tpl_item_veh_27', 'tpl_hse_vehicular', 27, 'JCB',             'Are the bucket & bucket teeth in good condition & free from damage / corrosion'),
  ('tpl_item_veh_28', 'tpl_hse_vehicular', 28, 'JCB',             'Are rotatory parts covered & guarded'),
  ('tpl_item_veh_29', 'tpl_hse_vehicular', 29, 'TRACTOR',         'Is a flagman available'),
  ('tpl_item_veh_30', 'tpl_hse_vehicular', 30, 'TRACTOR',         'Has protection (canopies, screens) been provided to shield operator from falling objects / hazards'),
  ('tpl_item_veh_31', 'tpl_hse_vehicular', 31, 'TRACTOR',         'Are the moving parts, shafts, sprockets, belts, etc., guarded'),
  ('tpl_item_veh_32', 'tpl_hse_vehicular', 32, 'TRACTOR',         'Has a safe means of access (steps, grab bars, non-slip surfaces) to the driver''s seat been provided'),
  ('tpl_item_veh_33', 'tpl_hse_vehicular', 33, 'TRACTOR',         'Is the lock of the back door (trailer) in working condition'),
  ('tpl_item_veh_34', 'tpl_hse_vehicular', 34, 'TRACTOR',         'Has protection against contact with hot surfaces, exhaust, etc. provided'),
  ('tpl_item_veh_35', 'tpl_hse_vehicular', 35, 'TRACTOR',         'Are the headlights in working condition'),
  ('tpl_item_veh_36', 'tpl_hse_vehicular', 36, 'TRACTOR',         'Are the tyres in good condition'),
  ('tpl_item_veh_37', 'tpl_hse_vehicular', 37, 'TRACTOR',         'Is an inter locking system between the tractor and the trailer available'),
  ('tpl_item_veh_38', 'tpl_hse_vehicular', 38, 'EXCAVATOR',       'Are the bolts / connecting pins (bucket) secured'),
  ('tpl_item_veh_39', 'tpl_hse_vehicular', 39, 'EXCAVATOR',       'Are the boom & the arm without damage / cut / crack'),
  ('tpl_item_veh_40', 'tpl_hse_vehicular', 40, 'EXCAVATOR',       'Has safe means of access to the driver seat been provided'),
  ('tpl_item_veh_41', 'tpl_hse_vehicular', 41, 'EXCAVATOR',       'Are the out riggers in working condition'),
  ('tpl_item_veh_42', 'tpl_hse_vehicular', 42, 'EXCAVATOR',       'Is the hydraulic oil level (max/min) indicator in working condition')
ON CONFLICT ("id") DO NOTHING;
