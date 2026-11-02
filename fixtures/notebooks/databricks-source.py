# Databricks notebook source
# MAGIC %md
# MAGIC # Orders pipeline
# MAGIC Reads the raw orders and counts them per day.

# COMMAND ----------

# DBTITLE 1,Load
orders = spark.read.table("raw.orders")
display(orders.limit(5))

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT order_date, COUNT(*) AS n
# MAGIC FROM raw.orders
# MAGIC GROUP BY order_date

# COMMAND ----------

# MAGIC %pip install requests
