-- Ziarem: lookup tables for Data Dictionary codes (decode raw lead/data later)
-- Run after 001 and 002 on the ziarem database.

-- Occupations: numeric (Occupation) + alpha-numeric (Occupation Code) in one table
CREATE TABLE dict_occupations (
  code        VARCHAR(50) PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE dict_doc_types (
  code        VARCHAR(50) PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE dict_property_types (
  code        VARCHAR(50) PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE dict_roof_types (
  code        VARCHAR(50) PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE dict_heating (
  code        VARCHAR(50) PRIMARY KEY,
  description TEXT NOT NULL
);

COMMENT ON TABLE dict_occupations IS 'Occupation codes: numeric (Occupation.csv) + alpha-numeric (Occupation Code.csv)';
COMMENT ON TABLE dict_doc_types IS 'Document type codes from Data Dictionary';
COMMENT ON TABLE dict_property_types IS 'Property class/type codes (e.g. PROP_CL_IND)';
COMMENT ON TABLE dict_roof_types IS 'Roof type codes (ROOF_TYPE)';
COMMENT ON TABLE dict_heating IS 'Heating codes (HEAT)';
