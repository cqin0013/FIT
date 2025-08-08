-- Create and select the DB
CREATE DATABASE IF NOT EXISTS city_data
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
  
USE city_data;
-- ############################### ----------
DROP TABLE road_segments;
-- Road segments referenced by bays & zone links
CREATE TABLE IF NOT EXISTS road_segments (
  segment_id            INT            NOT NULL,
  road_segment_desc     VARCHAR(500)   NULL,
  PRIMARY KEY (segment_id)
) ENGINE=InnoDB;

-- ############################## -----------

DROP TABLE parking_zones;
-- Parking zones (zone metadata)
CREATE TABLE IF NOT EXISTS parking_zones (
  parking_zone          INT            NOT NULL,
  on_street             VARCHAR(200)   NULL,
  street_from           VARCHAR(200)   NULL,
  street_to             VARCHAR(200)   NULL,
  PRIMARY KEY (parking_zone)
) ENGINE=InnoDB;

-- ############################## -----------


DROP TABLE zone_segments;
-- Link: which segments belong to which zone
CREATE TABLE IF NOT EXISTS zone_segments (
  parking_zone          INT NOT NULL,
  segment_id            INT NOT NULL,
  PRIMARY KEY (parking_zone, segment_id),
  KEY ix_zs_segment (segment_id),
  CONSTRAINT fk_zs_zone      FOREIGN KEY (parking_zone) REFERENCES parking_zones(parking_zone),
  CONSTRAINT fk_zs_segment   FOREIGN KEY (segment_id)   REFERENCES road_segments(segment_id)
) ENGINE=InnoDB;

-- #############################----------------


DROP TABLE sign_plates;
-- Sign plates (restrictions) per zone
CREATE TABLE IF NOT EXISTS sign_plates (
  sign_id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parking_zone          INT             NOT NULL,
  restriction_days      VARCHAR(50)     NULL,
  time_start            TIME            NULL,
  time_finish           TIME            NULL,
  restriction_display   VARCHAR(50)     NULL,
  PRIMARY KEY (sign_id),
  KEY ix_sp_zone (parking_zone),
  CONSTRAINT fk_sp_zone FOREIGN KEY (parking_zone) REFERENCES parking_zones(parking_zone)
) ENGINE=InnoDB;

-- #############################----------------
DROP TABLE bay_sensors;

-- Sensors (keep raw timestamps as strings; derive later if you want)
CREATE TABLE IF NOT EXISTS bay_sensors (
  sensor_id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lastupdated_raw       VARCHAR(40)     NULL,
  status_timestamp_raw  VARCHAR(40)     NULL,
  zone_number           INT             NULL,
  status_description    VARCHAR(50)     NULL,
  kerbside_id           INT             NULL,
  location_raw          VARCHAR(100)    NULL,
  PRIMARY KEY (sensor_id),
  KEY ix_sensors_kerbside (kerbside_id),
  KEY ix_sensors_zone (zone_number)
  -- FK to parking_bays.kerbside_id is fine to add now or later.
  -- If you want it now, uncomment below **after** you’re sure kerbside_id values won’t block inserts.
  -- ,CONSTRAINT fk_sensors_bay_kerbside
  --   FOREIGN KEY (kerbside_id) REFERENCES parking_bays(kerbside_id)
) ENGINE=InnoDB;

-- #############################----------------

DROP TABLE abs_raw_dump;

CREATE TABLE IF NOT EXISTS abs_raw_dump (
  row_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  src_file VARCHAR(120)    NULL,      -- e.g., 'ABS_2021.csv'
  c1       VARCHAR(400)    NULL,
  c2       VARCHAR(400)    NULL,
  c3       VARCHAR(400)    NULL,
  c4       VARCHAR(400)    NULL,
  c5       VARCHAR(400)    NULL,
  c6       VARCHAR(400)    NULL,
  c7       VARCHAR(400)    NULL,
  c8       VARCHAR(400)    NULL,
  c9       VARCHAR(400)    NULL,
  c10      VARCHAR(400)    NULL,
  PRIMARY KEY (row_id)
) ENGINE=InnoDB;


DROP TABLE abs_state_change;
CREATE TABLE IF NOT EXISTS abs_state_change (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  state_code    VARCHAR(20)     NOT NULL,  -- e.g., NSW, Vic.
  period_start  YEAR            NOT NULL,  -- 2016
  period_end    YEAR            NOT NULL,  -- 2017
  change_count  INT             NULL,      -- “no.”
  change_pct    DECIMAL(5,2)    NULL,      -- “%”
  PRIMARY KEY (id),
  KEY ix_abs_state_period (state_code, period_start, period_end)
) ENGINE=InnoDB;

SHOW FULL TABLES IN city_data;