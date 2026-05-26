-- MySQL dump 10.13  Distrib 8.0.38, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: homematch
-- ------------------------------------------------------
-- Server version	9.0.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Dumping data for table `appointments`
--

LOCK TABLES `appointments` WRITE;
/*!40000 ALTER TABLE `appointments` DISABLE KEYS */;
INSERT INTO `appointments` VALUES (1,NULL,NULL,2,'khảo sát','2026-05-25 19:13:41','Kh?o s�t t?i d?a ch? ch? nh�','completed','Test UI broker survey','2026-05-25 17:13:40'),(2,NULL,NULL,6,'khảo sát','2026-05-28 01:31:53','12 Tran Phu, Ha Noi','scheduled','Lịch hẹn mẫu cho broker@gmail.com','2026-05-26 01:31:52'),(3,NULL,NULL,7,'khảo sát','2026-05-28 01:32:43','12 Tran Phu, Ha Noi','scheduled','Lịch hẹn mẫu cho broker@gmail.com','2026-05-26 01:32:42');
/*!40000 ALTER TABLE `appointments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `broker_payments`
--

LOCK TABLES `broker_payments` WRITE;
/*!40000 ALTER TABLE `broker_payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `broker_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `commission_payments`
--

LOCK TABLES `commission_payments` WRITE;
/*!40000 ALTER TABLE `commission_payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `commission_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `commissions`
--

LOCK TABLES `commissions` WRITE;
/*!40000 ALTER TABLE `commissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `commissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `contract_legal_approvals`
--

LOCK TABLES `contract_legal_approvals` WRITE;
/*!40000 ALTER TABLE `contract_legal_approvals` DISABLE KEYS */;
/*!40000 ALTER TABLE `contract_legal_approvals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `deposit_returns`
--

LOCK TABLES `deposit_returns` WRITE;
/*!40000 ALTER TABLE `deposit_returns` DISABLE KEYS */;
/*!40000 ALTER TABLE `deposit_returns` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `deposit_transactions`
--

LOCK TABLES `deposit_transactions` WRITE;
/*!40000 ALTER TABLE `deposit_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `deposit_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `property_listings`
--

LOCK TABLES `property_listings` WRITE;
/*!40000 ALTER TABLE `property_listings` DISABLE KEYS */;
/*!40000 ALTER TABLE `property_listings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `property_submissions`
--

LOCK TABLES `property_submissions` WRITE;
/*!40000 ALTER TABLE `property_submissions` DISABLE KEYS */;
INSERT INTO `property_submissions` VALUES (1,8,'canho',75.00,'dongnam',2,2,'123 Nguyen Trai, Ha Noi',12500000000.00,'[\"https://example.com/a.jpg\",\"https://example.com/b.jpg\"]','pending','2026-05-25 15:35:40',NULL),(2,9,'datnen',555.00,'nam',4,5,'hyhgffggg',5000000.00,'[]','surveyed','2026-05-25 15:42:06',6),(3,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'draft','2026-05-25 15:52:02',NULL),(4,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'draft','2026-05-25 16:10:03',NULL),(5,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'cancelled','2026-05-25 16:10:31',NULL),(6,9,'canho',85.00,'dong',2,2,'12 Tran Phu, Ha Noi',12000000.00,'[\"demo-front.jpg\",\"demo-living.jpg\"]','pending','2026-05-26 01:31:52',11),(7,9,'canho',85.00,'dong',2,2,'12 Tran Phu, Ha Noi',12000000.00,'[\"demo-front.jpg\",\"demo-living.jpg\"]','pending','2026-05-26 01:32:42',11);
/*!40000 ALTER TABLE `property_submissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `rental_contract_approvals`
--

LOCK TABLES `rental_contract_approvals` WRITE;
/*!40000 ALTER TABLE `rental_contract_approvals` DISABLE KEYS */;
/*!40000 ALTER TABLE `rental_contract_approvals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `rental_contracts`
--

LOCK TABLES `rental_contracts` WRITE;
/*!40000 ALTER TABLE `rental_contracts` DISABLE KEYS */;
/*!40000 ALTER TABLE `rental_contracts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `staff_assignments`
--

LOCK TABLES `staff_assignments` WRITE;
/*!40000 ALTER TABLE `staff_assignments` DISABLE KEYS */;
/*!40000 ALTER TABLE `staff_assignments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `submission_contracts`
--

LOCK TABLES `submission_contracts` WRITE;
/*!40000 ALTER TABLE `submission_contracts` DISABLE KEYS */;
/*!40000 ALTER TABLE `submission_contracts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `survey_records`
--

LOCK TABLES `survey_records` WRITE;
/*!40000 ALTER TABLE `survey_records` DISABLE KEYS */;
INSERT INTO `survey_records` VALUES (1,2,6,1,'{\"water\":\"day_du\",\"electric\":\"on_dinh\"}','{\"traffic\":\"thuan_tien\",\"security\":\"tot\"}','{\"dispute\":\"khong\",\"red_book\":\"chinh_chu\"}','[\"image1.jpg\",\"image2.jpg\"]','Khao sat dat yeu cau','dat','2026-05-25 17:13:53'),(2,2,6,1,'{\"electricStable\":false,\"waterStable\":false,\"wifiStable\":false}','{\"areaNote\":\"\"}','{\"legalNote\":\"\"}','[]','Test UI broker survey','dat','2026-05-25 17:18:18');
/*!40000 ALTER TABLE `survey_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'huyền mi','dd','buihuyenmi2005@gmail.com','dd','$2b$10$FIvAuPdF8NpCLolrZe2OPuAY8Cb0IWfMlI6YZ4PIJb9szvpQClnIW','owner','2026-05-25 15:07:12',NULL,NULL),(2,'abc','0 123 456 78 90','buihuyenmi2006@gmail.com','www','$2b$10$aQS9BG553NwPBk6yWqo4jOsMlU.eMQsQDNhKpMi73fURDZkP999KK','tenant','2026-05-25 15:08:47',NULL,NULL),(3,'Nguyễn Văn A','0901234567','nguyenvana@gmail.com','001099000001','hashed_pass_1','owner','2026-05-25 15:19:54',NULL,NULL),(4,'Trần Thị B','0912345678','tranthib@gmail.com','001099000002','hashed_pass_2','tenant','2026-05-25 15:19:54',NULL,NULL),(5,'Lê Văn C','0923456789','levanc@gmail.com','001099000003','hashed_pass_3','broker','2026-05-25 15:19:54','0ec31aa162ca49bc4d008cf6f134943c65eee28c6332f6369afd1c0f805ce76a','2026-06-02 08:13:27'),(6,'Phạm Thị D','0934567890','phamthid@gmail.com','001099000004','hashed_pass_4','sale','2026-05-25 15:19:54','fd065df76938f9629a9a5b38ef8d7dc9767f44fbc9697b96e60bfcc5682d730d','2026-06-02 08:14:44'),(7,'Hoàng Văn E','0945678901','hoangvane@gmail.com','001099000005','hashed_pass_5','manager','2026-05-25 15:19:54',NULL,NULL),(8,'Test Owner API','0901234567','test.owner.api.20260525223540@gmail.com','012345678901',NULL,'owner','2026-05-25 15:35:40',NULL,NULL),(9,'Demo Owner','0901234567','demo.owner.localtest@example.com','03838383838383','$2b$10$D/q5c3ZhrSF2FqwNn1odI.tQdgm56hlIei8e8jLnQ0hlMVNzhx9XO','owner','2026-05-25 15:40:47','0512117f8eb2e217b6499c2a207f042d1e2fe84f76980c6a4c31ca163df38c5b','2026-06-02 00:05:32'),(10,'test','0123456789','admin@gmail.com','6363633663','$2b$10$7zKgI2BBtCwlyOgxtKcJJOP9f7NQrnfC7rsD1CYv.i8ZWlLmzNXIC','owner','2026-05-25 15:50:35',NULL,NULL),(11,'broker',NULL,'broker@gmail.com',NULL,'$2b$10$pgL9gbZjwxv.iXWOdUfLJeoLdcnd/nKhuaewn.V2gYV1FI9hAgSgC','broker','2026-05-25 17:20:53','3c4cf4b961a97a46a7f9a283422f04e8101d02388e0750912bcfd45912c29e99','2026-06-02 08:28:39');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-26  9:06:41
