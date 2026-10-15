"use strict";

(function exposeCourseTopics(root, factory) {
  const topics = factory();
  if (typeof module === "object" && module.exports) module.exports = topics;
  if (root) root.EGE_COURSE_TOPICS = topics;
})(typeof globalThis === "object" ? globalThis : this, () => ([
            {
                id: "soc1", subject: "soc", lesson: "01", title: "Человек и его потребности",
                notes: "sociology/1. Человек и его потребности..pdf",
                homework: "hw-sociology/ДЗ 1. Человек и его потребности.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSfH-PHnaZ1HXc_NYEEPhD8Jj8VsM170FSS79--Rst3fXZuEWA/viewform"
            },
            {
                id: "soc2", subject: "soc", lesson: "02", title: "Мировоззрение и мышление",
                notes: "sociology/2. Мировоззрение и мышление.pdf",
                homework: "hw-sociology/ДЗ 2. Мировоззрение и мышление.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdOKvLAJg_lT3Elvr_nMRgUNNwksfcVKKAFqrEhquaWIX_Jgw/viewform"
            },
            {
                id: "soc3", subject: "soc", lesson: "03", title: "Деятельность и способности",
                notes: "sociology/3. Деятельность и способности.pdf",
                homework: "hw-sociology/ДЗ 3. Деятельность и способности.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLScO-H9gECxe77r5PWJNAQYjO5CJA4g0ZDWJ3826NNRyzFUTTA/viewform"
            },
            {
                id: "soc4", subject: "soc", lesson: "04", title: "Познание. Истина",
                notes: "sociology/4. Познание. Истина...pdf",
                homework: "hw-sociology/ДЗ 4. Познание и истина.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSeruyFMTFVcO-pVeeOCcL3Vk5l1VNzDr5FrC8ZkzXzPJJLgiA/viewform"
            },
            {
                id: "soc5", subject: "soc", lesson: "05", title: "Общество и его системное строение",
                notes: "sociology/5. Общество и его системное строение..pdf",
                homework: "hw-sociology/ДЗ 5. Общество, его системное строение.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSf9-ajeN2SKjlcEaSroEEhnQ16pKSp6lbsMS4ru8jInCh81ag/viewform"
            },
            {
                id: "soc6", subject: "soc", lesson: "06", title: "Глобализация. Глобальные проблемы",
                notes: "sociology/6. Глобализация. Глобальные проблемы.pdf",
                homework: "hw-sociology/ДЗ 6. Глобализация.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSfyW9-ji8Bv6JjXJifP6lHUc9yfAGMmAVfxxHYbvIW6ue3gxw/viewform"
            },
            {
                id: "soc7", subject: "soc", lesson: "07", title: "Типология обществ",
                notes: "sociology/7. Типлогия общества.pdf",
                homework: "hw-sociology/ДЗ 7. Типология обществ.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSe2qoqTWwHJLLTBQ_8rlcd3YVLhk75mJIAwHrpxBh6_-5x4kg/viewform"
            },
            {
                id: "soc8", subject: "soc", lesson: "08", title: "Культура. Наука и образование",
                notes: "sociology/8. Культура (наука и образование).pdf",
                homework: "hw-sociology/ДЗ 8. Культура (наука и образование).docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSf4_ha2dxsqdsJDKfan9kIN0-cNGWN8xRihA-mzxJh-KaudcA/viewform"
            },
            {
                id: "soc9", subject: "soc", lesson: "09", title: "Культура. Искусство, мораль, религия",
                notes: "sociology/9. Культура (искусство, религия, мораль).pdf",
                homework: "hw-sociology/ДЗ 9. Культура (Искусство. Мораль. Религия).docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSenKkFI2IwAP9PBlPk4I0lOdoE9vd087DBgVCvlMD41uosvTQ/viewform"
            },
            {
                id: "soc10", subject: "soc", lesson: "10", title: "Социальная стратификация и мобильность",
                notes: "sociology/10. Соц. стратификация. Соц. мобильность.pdf",
                homework: "hw-sociology/ДЗ 10. Соц. стратификация. Соц. мобильность.docx",
                testLesson: 11,
                test: "https://docs.google.com/forms/d/e/1FAIpQLSfSPCEPElKaktqqgoqyfrilY_WogE_8mAoNfK23AX1bOV2LyA/viewform"
            },
            {
                id: "soc11", subject: "soc", lesson: "11", title: "Социальные группы. Этнос",
                notes: "sociology/11. Соц. группы. Этнос.pdf",
                homework: "hw-sociology/ДЗ 11. Соц. группы. Этнос.docx",
                testLesson: 10,
                test: "https://docs.google.com/forms/d/e/1FAIpQLSfCKr4InJZ8g6aLBz7toa0MlL8owPw_agJmVBz_I786irVrIg/viewform"
            },
            {
                id: "soc12", subject: "soc", lesson: "12", title: "Социальные ценности. Социальный конфликт",
                notes: "sociology/12. Соц. ценности. Соц. конфликт.pdf",
                homework: "hw-sociology/ДЗ 12. Соц. ценности. Соц. конфликт.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSeZQkQFhTKAFNGOpBK4p57d_Imig67ROM4KcJHx7M4EAb_y8A/viewform"
            },
            {
                id: "soc13", subject: "soc", lesson: "13", title: "Социальный контроль. Отклоняющееся поведение",
                notes: "sociology/13. Соц. контроль.pdf",
                homework: "hw-sociology/ДЗ 13. Соц. контроль.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSe0euVwiQmgAqbgjjvQQ4rmXCrVeomz0rx826T1PyD5Sb6DOg/viewform"
            },
            {
                id: "soc14", subject: "soc", lesson: "14", title: "Семья и брак",
                notes: "sociology/14. Семья.pdf",
                homework: "hw-sociology/ДЗ 14. Семья и брак.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSd5jhvcESVf1FE7dOoZH0xzm-heBCnQs2HHBWtwHHlKFKLafw/viewform"
            },
            {
                id: "eco15", subject: "eco", lesson: "15", title: "Экономика как наука и хозяйство",
                notes: "economy/15. Экономика как наука и хозяйство.pdf",
                homework: "hw-economy/ДЗ 15. Экономика как наука и хозяйство.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSd-a9PIxJBDuhjvDZyoSFINyGm1IdJu4hMFwEkG-ZRCdfURLg/viewform"
            },
            {
                id: "eco16", subject: "eco", lesson: "16", title: "Экономические системы",
                notes: "economy/16. Экономические системы.pdf",
                homework: "hw-economy/ДЗ 16. Экономические системы.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSer00qeKGXV6NhbDuScKu7J1nBsjl9IDyq4PQIcakBPYHyqKg/viewform"
            },
            {
                id: "eco17", subject: "eco", lesson: "17", title: "Рынок. Спрос и предложение",
                notes: "economy/17. Рынок. Спрос и предложение. pdf.pdf",
                homework: "hw-economy/ДЗ 17. Рынок. Спрос и предложение.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLScBComEkmc1aYdw2GAPy1jmK6nAu01la8iZaln-SD0MwVA8FA/viewform"
            },
            {
                id: "eco18", subject: "eco", lesson: "18", title: "Рынок. Торговля",
                notes: "economy/18. Рынок. Торговля.pdf",
                homework: "hw-economy/ДЗ 18. Рынок. Торговля.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdUeyT3hNRAuhoVvLZwO1plsa92XzqTvNDntZN-MM73-vdT2w/viewform"
            },
            {
                id: "eco19", subject: "eco", lesson: "19", title: "Виды рынков. Конкуренция",
                notes: "economy/19.Виды рынков. Конкуренция.pdf",
                homework: "hw-economy/ДЗ 19. Виды рынков. Конкуренция.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdK_Asa9-AlKYty6lxnfhZs4_NZuPbUa4_97V5x2SkaZyRw9Q/viewform"
            },
            {
                id: "eco20", subject: "eco", lesson: "20", title: "Государство в рыночной экономике. Мировая экономика",
                notes: "economy/20. Государство в рыночной экономике. Мировая экономика. pdf.pdf",
                homework: "hw-economy/ДЗ 20. Государство в рыночной экономике.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLScX7Mg1wodiANsYpX4YKGe4tKLEBRaqkQ2VcYuxMT35_hwehQ/viewform"
            },
            {
                id: "eco21", subject: "eco", lesson: "21", title: "Государственный бюджет. Собственность",
                notes: "economy/21. Государственный бюджет. Собственность. pdf.pdf",
                homework: "hw-economy/ДЗ 21. Гос. бюджет. Собственность.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSfGONZV8kJDYTe2o-UdpiMUheHmtmn1rugtvNdkhCdGgasTdA/viewform"
            },
            {
                id: "eco22", subject: "eco", lesson: "22", title: "Финансовые институты. Финансовые услуги",
                notes: "economy/22. Финансовые институты. Финансовые услуги. pdf.pdf",
                homework: "hw-economy/ДЗ 22. Финансовые институты.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSesNJaGahmofvMxXBNQROew9iiLJb5O9khxapkuhexZP2pEMA/viewform"
            },
            {
                id: "eco23", subject: "eco", lesson: "23", title: "Предпринимательство",
                notes: "economy/23. Предпринимательство.pdf",
                homework: "hw-economy/ДЗ 23. Предпринимательство.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSce7Ff0Z6UDqH59Fqy4EEbLW2yjdYOhCjwuJlgsHKaKXF8QuA/viewform"
            },
            {
                id: "eco24", subject: "eco", lesson: "24", title: "Деньги. Ценные бумаги",
                notes: "economy/24. Деньги. Ценные бумаги.pdf",
                homework: "hw-economy/ДЗ 24. Деньги. Ценные бумаги.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdAzaVXtfiKz-50RXZqfGeonCNzJlCZZD-9LOApaHDWdg7BkQ/viewform"
            },
            {
                id: "eco25", subject: "eco", lesson: "25", title: "Инфляция. Семейный бюджет",
                notes: "economy/25. Инфляция. Семейный бюджет.pdf",
                homework: "hw-economy/ДЗ 25. Инфляция. Семейный бюджет.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdYgHiwEocuP7QYTIR7X6Ov1ChytxPhPdJ6EjiEL_4g3Jq8Lw/viewform"
            },
            {
                id: "eco26", subject: "eco", lesson: "26", title: "Рынок труда",
                notes: "economy/26. Рынок труда.pdf",
                homework: "hw-economy/ДЗ 26. Рынок труда .docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSedJY_fC7Hj0KRtrFcV7XvRSapsUuk47Eacyhwe-FVmmrK-lQ/viewform"
            },
            {
                id: "eco27", subject: "eco", lesson: "27", title: "Экономический рост",
                notes: "economy/27. Экономический рост.pdf",
                homework: "hw-economy/ДЗ 27. Экономический рост.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLScbbLfL7j7CUEOmhQNtD02yrbdX7u7yuLk65LGUJNQy6KmhLA/viewform"
            },
            {
                id: "eco28", subject: "eco", lesson: "28", title: "Налоги",
                notes: "economy/28. Налоги.pdf",
                homework: "hw-economy/ДЗ 28. Налоги.docx",
                test: "https://docs.google.com/forms/d/e/1FAIpQLSdA1SeKjXdQFbDfI3HMAlUyXc_XuH2EClaVRejI0WMIpjV8lQ/viewform"
            },
            {
                id: "pol29", subject: "pol", lesson: "29", title: "Политика. Политическая деятельность",
                notes: "politics/29. Политика. Политическая деятельность.pdf",
                homework: "hw-politics/ДЗ 29. Политика. Политическая деятельность.docx",
                testLesson: 29
            },
            {
                id: "pol30", subject: "pol", lesson: "30", title: "Политическое лидерство. Политическая элита",
                notes: "politics/30. Политическое лидерство. Политическая элита.pdf",
                homework: "hw-politics/ДЗ 30. Политическое лидерство. Политическая элита.docx",
                testLesson: 30
            },
            {
                id: "pol31", subject: "pol", lesson: "31", title: "Политическая система и государство",
                notes: "politics/31. Политическая система и гос-во.pdf",
                homework: "hw-politics/ДЗ 31. Политическая система и государство.docx",
                testLesson: 31
            },
            {
                id: "pol32", subject: "pol", lesson: "32", title: "Форма государства",
                notes: "politics/32. Форма государства.pdf",
                homework: "hw-politics/ДЗ 32. Форма государства.docx",
                testLesson: 32
            },
            {
                id: "pol33", subject: "pol", lesson: "33", title: "Форма государственного устройства. Политический режим",
                notes: "politics/33. Форма гос. устройства. Политический режим.pdf",
                homework: "hw-politics/ДЗ 33. Форма гос. устройства. Политический режим.docx",
                testLesson: 33
            },
            {
                id: "pol34", subject: "pol", lesson: "34", title: "Организация власти в РФ. Законодательный процесс",
                notes: "politics/34. Организация власти в РФ. Законодательный процесс.pdf",
                homework: "hw-politics/ДЗ 34. Организация власти в РФ.docx",
                testLesson: 34
            },
            {
                id: "pol35", subject: "pol", lesson: "35", title: "Полномочия высших органов власти",
                notes: "politics/35. Полномочия высших органов власти .pdf",
                homework: "hw-politics/ДЗ 35. Полномочия высших органов власти.docx",
                testLesson: 35
            },
            {
                id: "pol36", subject: "pol", lesson: "36", title: "Россия — федеративное государство. Социальная политика",
                notes: "politics/36. РФ - федеративное государство. Социальная политика РФ .pdf",
                homework: "hw-politics/ДЗ 36. РФ - федеративное государство.docx",
                testLesson: 36
            },
            {
                id: "pol37", subject: "pol", lesson: "37", title: "Демократия. Политическое участие",
                notes: "politics/37. Демократия. Политическое участие .pdf",
                homework: "hw-politics/ДЗ 37. Демократия. Политическое участие.docx"
            },
            {
                id: "pol38", subject: "pol", lesson: "38", title: "Избирательные системы",
                notes: "politics/38. Избирательные системы .pdf",
                homework: "hw-politics/ДЗ 38. Избирательные системы.docx"
            },
            {
                id: "pol39", subject: "pol", lesson: "39", title: "Гражданское общество. Правовое государство",
                notes: "politics/39. Гражданское общество. Правовое государство.pdf",
                homework: "hw-politics/ДЗ 39. Гражданское общество. Правовое государство.docx"
            },
            {
                id: "pol40", subject: "pol", lesson: "40", title: "Политическая идеология",
                notes: "politics/40. Политическая идеология.pdf",
                homework: "hw-politics/ДЗ 40. Политическая идеология.docx"
            },
            {
                id: "pol41", subject: "pol", lesson: "41", title: "Политические партии и движения",
                notes: "politics/41. Политические партии и движения.pdf",
                homework: "hw-politics/ДЗ 41. Политические партии и движения.docx"
            },
            {
                id: "pol42", subject: "pol", lesson: "42", title: "Политическая культура",
                notes: "politics/42. Политическая культура.pdf",
                homework: "hw-politics/ДЗ 42. Политическая культура.docx"
            },
            {
                id: "law43", subject: "law", lesson: "43", title: "Право в системе социальных норм. Источники права",
                testLesson: 43
            },
            {
                id: "law44", subject: "law", lesson: "44", title: "Система права. Правоотношения",
                testLesson: 44
            },
            {
                id: "law45", subject: "law", lesson: "45", title: "Правонарушения. Юридическая ответственность",
                testLesson: 45
            },
            {
                id: "law46", subject: "law", lesson: "46", title: "Конституция. Права и обязанности",
                testLesson: 46
            },
            {
                id: "law47", subject: "law", lesson: "47", title: "Гражданство РФ. Воинская служба",
                testLesson: 47
            },
            {
                id: "law48", subject: "law", lesson: "48", title: "Правоохранительные органы",
                testLesson: 48
            },
            {
                id: "law49", subject: "law", lesson: "49", title: "Судопроизводство",
                testLesson: 49
            },
            {
                id: "law50", subject: "law", lesson: "50", title: "Административное и уголовное право",
                testLesson: 50
            },
            {
                id: "law51", subject: "law", lesson: "51", title: "Трудовое право",
                testLesson: 51
            },
            {
                id: "law52", subject: "law", lesson: "52", title: "Гражданское право №1. Субъекты гражданского права",
                testLesson: 52
            },
            {
                id: "law53", subject: "law", lesson: "53", title: "Гражданское право №2. Имущественные и неимущественные права",
                testLesson: 53
            },
            {
                id: "law54", subject: "law", lesson: "54", title: "Организационно-правовые формы предприятий",
                testLesson: 54
            },
            {
                id: "law55", subject: "law", lesson: "55", title: "Семейное право",
                testLesson: 55
            },
            {
                id: "law56", subject: "law", lesson: "56", title: "Экологическое право",
                testLesson: 56
            }
]));
