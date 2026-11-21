-- Local benchmark fixture only. This file is outside the Wrangler migrations directory.
INSERT INTO departments (workspace_id,id,name_en,name_bn)
VALUES
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000111','Technology Services','প্রযুক্তি সেবা'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000112','Facilities','সুবিধা ব্যবস্থাপনা'),
 ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000113','Planning and Quality','পরিকল্পনা ও গুণমান');

WITH people(n,first_name,last_name) AS (
 VALUES (1,'Anika','Haque'),(2,'Imran','Kabir'),(3,'Rumana','Akter'),(4,'Shafiq','Islam'),
 (5,'Mita','Das'),(6,'Nasir','Uddin'),(7,'Sadika','Rahman'),(8,'Arman','Hassan'),
 (9,'Tania','Sultana'),(10,'Rubel','Hossain'),(11,'Ayesha','Khan'),(12,'Masud','Alam'),
 (13,'Sumaiya','Karim'),(14,'Rashed','Hasan'),(15,'Puja','Roy'),(16,'Raihan','Ahmed'),
 (17,'Sabiha','Basu'),(18,'Tanvir','Miah'),(19,'Zerin','Sarkar'),(20,'Adnan','Iqbal')
)
INSERT INTO employees (workspace_id,id,official_employee_id,department_id,first_name_en,last_name_en,designation,joining_date,email)
SELECT '00000000-0000-0000-0000-000000000000',printf('00000000-0000-4000-8000-%012d',220+n),
 printf('DEMO-%03d',10+n),printf('00000000-0000-4000-8000-%012d',111+(n-1)%3),
 first_name,last_name,CASE (n-1)%3 WHEN 0 THEN 'Systems Officer' WHEN 1 THEN 'Facilities Coordinator' ELSE 'Planning Analyst' END,
 printf('2020-02-%02d',n),printf('seed-%02d@example.invalid',n)
FROM people;

INSERT INTO users (workspace_id,id,employee_id,role)
SELECT workspace_id,replace(id,'0000000002','0000000003'),id,'EMPLOYEE'
FROM employees WHERE workspace_id='00000000-0000-0000-0000-000000000000'
 AND official_employee_id BETWEEN 'DEMO-011' AND 'DEMO-030';
