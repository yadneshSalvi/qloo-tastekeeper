-- Only runs when the local development PostgreSQL volume is first created.
-- Integration tests may truncate this database; never point them at demo data.
CREATE DATABASE tastekeeper_test OWNER qloo;
