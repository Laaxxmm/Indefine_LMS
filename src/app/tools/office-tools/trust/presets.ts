// Trust-type presets — short (2 paragraphs) + detailed (15-20 points) objects, ported
// verbatim from tools/trust.py. Selecting a type auto-fills the two editable textareas.

export const TRUST_TYPES = [
  "Educational", "Community Development", "Elderly Care", "Environmental", "Children's Welfare",
  "Sanitation and Environment", "Waste Management", "Civic Education", "Health and Welfare", "Poverty Alleviation", "Other",
];

export const DESIGNATIONS = [
  "Trustee", "Managing Trustee", "Secretary", "Author", "Chairperson", "President", "Treasurer", "Vice President", "Joint Secretary", "Executive Trustee",
];

export const SHORT_OBJECTS: Record<string, string> = {
  "Educational": "The primary focus of this trust is to advance education for underprivileged children through various aids and incentives. This includes providing books, stipends, scholarships, and other resources to promote literacy and knowledge advancement.\n\nThe trust aims to support educational career development and loans, ensuring that deserving students can pursue their academic goals without financial barriers. Through these initiatives, the trust seeks to foster a more educated and empowered society. ",
  "Community Development": "This trust is dedicated to community development by encouraging collective action to address common problems. It promotes unity and collaborative solutions among community members to improve living conditions and social harmony.\n\nBy facilitating programs that enhance community engagement and self-reliance, the trust strives to create sustainable development and empower local populations to take charge of their future. ",
  "Elderly Care": "The trust is committed to supporting elderly care through organizations like old age homes for the destitute and needy. It aims to ensure social security and well-being for senior citizens who require assistance.\n\nThrough partnerships with women welfare homes and other support systems, the trust seeks to provide a safe and dignified environment for the elderly, addressing their physical, emotional, and financial needs. ",
  "Environmental": "This trust focuses on developing eco-smart environments to solve environmental issues innovatively. It promotes sustainable practices and smart technologies to protect and restore the natural world.\n\nBy implementing projects that address climate change, pollution, and resource conservation, the trust aims to create a healthier planet for future generations through awareness and action. ",
  "Children's Welfare": "Dedicated to children's welfare, this trust provides necessary assistance to curb malnutrition, offer education, and ensure healthcare for underprivileged children. It establishes programs to improve overall child development and family support.\n\nThe trust works towards the holistic improvement of children's lives, including motivation, life skills training, and linking to support systems for long-term self-sufficiency. ",
  "Sanitation and Environment": "The trust raises awareness on sanitation, environment, and sustainable development. It organizes cleanliness drives to maintain public spaces and promotes eco-friendly habits among the public.\n\nThrough education and community involvement, the trust aims to foster a culture of responsibility towards the environment, ensuring cleaner and greener communities. ",
  "Waste Management": "Focused on waste management, the trust promotes segregation and efficient, environment-friendly methods. It educates the public on proper waste handling to reduce pollution and encourage recycling.\n\nBy implementing innovative waste solutions, the trust seeks to minimize environmental impact and support sustainable urban living. ",
  "Civic Education": "This trust promotes civic education by raising awareness of traffic rules, municipal laws, and civic duties. It connects with the public through various mediums to foster responsible citizenship.\n\nThe trust aims to build a society where citizens actively participate in maintaining law and order, contributing to community well-being. ",
  "Health and Welfare": "The trust organizes health, educational, and welfare programs for women and children. It addresses their specific needs through targeted initiatives and support systems.\n\nBy promoting healthier lifestyles and voluntary social service, the trust strives to improve the quality of life for vulnerable groups. ",
  "Poverty Alleviation": "Aimed at poverty alleviation, the trust creates programs for families in poverty, providing education, healthcare, and basic needs. It motivates and equips them with life skills for self-sufficiency.\n\nThe trust encourages contributions to the community, fostering a cycle of support and empowerment among underprivileged individuals. ",
  "Other": "Custom trust type for unique charitable purposes. Please provide a short description in two paragraphs.\n\nThis allows flexibility for specialized objects not covered in predefined types, ensuring the trust meets specific needs. ",
};

export const DETAILED_OBJECTS: Record<string, string> = {
  "Educational": `a. To provide education of children by granting aid including but not limited to the supply of books, stipends, medals, prizes, grants, scholarships, awards, medicines, educational career support, educational loans, bursaries and other incentives for purposes of the advancement of knowledge, education and literacy.
b. To establish, maintain, or acquire schools, colleges, and educational institutions for imparting general, technical, professional, or vocational education.
c. To organize seminars, workshops, and training programs for teachers and educators to enhance teaching methodologies.
d. To set up libraries and reading rooms equipped with books, journals, and digital resources for public use.
e. To collaborate with government and non-government organizations to implement educational schemes for underprivileged sections.
f. To conduct research in educational methodologies and publish findings to improve educational standards.
g. To provide counseling and guidance services for students to help them choose appropriate career paths.
h. To organize extracurricular activities like sports, arts, and cultural events to promote holistic development.
i. To support adult literacy programs and continuing education for lifelong learning.
j. To develop online platforms and e-learning tools to make education accessible in remote areas.
k. To award prizes and recognitions to outstanding students and educators to motivate excellence.
l. To establish scholarships for higher education in reputed institutions for meritorious students from low-income families.
m. To provide nutritional support to school children to ensure their physical well-being for better learning.
n. To conduct awareness campaigns on the importance of education in rural and urban slums.
o. To partner with corporate entities for funding educational projects through CSR initiatives.
p. To set up vocational training centers to equip youth with employable skills.
q. To organize summer camps and educational tours for experiential learning.
r. To support special education for children with disabilities.
s. To promote girl child education and gender equality in access to learning opportunities.
t. To monitor and evaluate the impact of educational programs and make necessary improvements.`,
  "Community Development": `b. Community development, where community members come together to take collective action and solutions to common problems.
c. To organize community meetings and forums for discussing local issues and finding solutions.
d. To provide training in leadership and community organizing skills.
e. To develop infrastructure projects like roads, water supply, and sanitation in underserved areas.
f. To promote economic development through microfinance and small business support.
g. To conduct health camps and awareness programs for community health improvement.
h. To support cultural preservation and promotion activities within communities.
i. To facilitate access to government schemes and services for community members.
j. To organize disaster preparedness and response training.
k. To promote environmental conservation through community-led initiatives.
l. To support women's empowerment groups and self-help groups.
m. To develop youth programs for skill development and employment.
n. To create recreational spaces and community centers.
o. To conduct surveys and research on community needs and priorities.
p. To partner with NGOs and government for large-scale development projects.
q. To promote peace and harmony through inter-community dialogues.
r. To provide legal aid and awareness on rights and entitlements.
s. To organize vocational training for unemployed community members.
t. To support agricultural development and farmer cooperatives.
u. To monitor and evaluate community development projects for effectiveness.`,
  "Elderly Care": `c. To support organizations such as old age homes for the destitute and needy, women welfare homes, etc to ensure social security to the citizens.
d. To establish and maintain old age homes providing shelter, food, and medical care for elderly persons.
e. To organize medical check-ups and health camps specifically for senior citizens.
f. To provide emotional support through counseling and companionship programs.
g. To facilitate recreational activities and social events for the elderly to combat loneliness.
h. To partner with healthcare providers for subsidized medical treatments and medicines.
i. To offer financial assistance for elderly individuals in need.
j. To conduct awareness campaigns on elder abuse and rights.
k. To train caregivers and staff for better elderly care.
l. To collaborate with government schemes for senior citizens' welfare.
m. To set up day care centers for elderly to support working families.
n. To promote intergenerational programs linking youth with seniors.
o. To provide legal aid for elderly facing property or family disputes.
p. To organize nutritional programs to address dietary needs of seniors.
q. To support mobility aids and home modifications for elderly independence.
r. To conduct research on aging and advocate for policy changes.
s. To establish emergency response systems for elderly living alone.
t. To promote mental health support through therapy and support groups.
u. To integrate technology for elderly, like health monitoring apps.`,
  "Environmental": `d. Developing Eco-smart environment where the environmental will be solved in an innovative and smart manner.
e. To promote sustainable development practices in communities.
f. To conduct tree plantation drives and afforestation projects.
g. To organize workshops on renewable energy sources.
h. To advocate for policy changes to protect the environment.
i. To support research in green technologies.
j. To collaborate with schools for environmental education.
k. To implement water conservation projects.
l. To promote wildlife protection and biodiversity conservation.
m. To organize clean-up drives for rivers and beaches.
n. To develop eco-friendly products and promote their use.
o. To conduct awareness campaigns on climate change.
p. To support organic farming and sustainable agriculture.
q. To create green spaces in urban areas.
r. To monitor environmental pollution and report to authorities.
s. To partner with NGOs for large-scale environmental projects.
t. To promote eco-tourism for sustainable income.
u. To educate on waste reduction and recycling.
v. To support carbon footprint reduction initiatives.
w. To organize environmental festivals and events.`,
  "Children's Welfare": `e. Engaging in the children development by providing necessary assistance, curbing malnutrition, providing education and health care of the children establishment and implementation of programs that will improve the welfare of children, women, senior citizens and underprivileged citizens of India.
f. To provide nutritional supplements and meals to underprivileged children.
g. To organize medical check-ups and vaccination drives for children.
h. To establish orphanages and child care centers.
i. To support adoption programs and family reunification.
j. To conduct child rights awareness campaigns.
k. To provide counseling services for traumatized children.
l. To organize educational camps and tuition classes.
m. To promote child labor prevention and rehabilitation.
n. To support recreational activities for children's development.
o. To collaborate with schools for scholarship programs.
p. To provide clothing and basic necessities to needy children.
q. To conduct workshops on hygiene and health education.
r. To advocate for child protection laws and policies.
s. To set up helplines for child abuse reporting.
t. To partner with NGOs for child welfare projects.
u. To monitor and evaluate child welfare programs.
v. To promote foster care systems.
w. To organize sports events for physical development.`,
  "Sanitation and Environment": `f. To raise awareness amongst the public regarding sanitation and the environment and sustainable development and environment protection.
g. To organize, mobilize and conduct cleanliness drives to clean and keep clean public spaces, such as roads, plazas, transport terminals, etc.
h. To conduct workshops on sustainable sanitation practices.
i. To promote the use of eco-friendly toilets and sanitation facilities.
j. To collaborate with local governments for sanitation infrastructure.
k. To organize awareness campaigns on water conservation.
l. To support community-led sanitation projects.
m. To conduct research on sanitation technologies.
n. To advocate for policy changes in sanitation and environment.
o. To partner with schools for sanitation education.
p. To provide sanitation kits to underprivileged areas.
q. To monitor sanitation conditions in communities.
r. To promote composting and waste-to-energy projects.
s. To organize environmental clean-up events.
t. To support tree planting for environmental balance.
u. To educate on the impact of pollution on health.
v. To develop mobile apps for reporting sanitation issues.
w. To collaborate with international organizations for best practices.`,
  "Waste Management": `h. To raise awareness amongst the public regarding waste management and waste segregation and to promote efficient environment-friendly methods of waste management.
i. To conduct workshops on waste segregation techniques.
j. To promote recycling and upcycling programs.
k. To collaborate with municipalities for waste collection systems.
l. To organize waste audits in communities.
m. To support waste-to-energy projects.
n. To advocate for policy changes in waste management.
o. To partner with schools for waste education.
p. To provide bins and tools for waste segregation.
q. To monitor waste disposal practices.
r. To develop apps for waste management tracking.
s. To organize community clean-up drives.
t. To promote composting in households.
u. To conduct research on waste reduction methods.
v. To support industrial waste management initiatives.
w. To educate on the dangers of plastic waste.`,
  "Civic Education": `i. To raise awareness and promote obeisance towards traffic rules, municipal laws, fundamental duties and civic duties of citizens.
j. To connect with the public through all mediums, including digital, in order to raise awareness and promote environmental protection and civic duty.
k. To organize workshops on traffic safety.
l. To conduct campaigns on municipal laws compliance.
m. To promote civic duties through public service announcements.
n. To partner with schools for civic education programs.
o. To develop online courses on fundamental duties.
p. To organize community events for civic awareness.
q. To advocate for better civic infrastructure.
r. To monitor compliance with civic laws.
s. To provide legal aid for civic issues.
t. To collaborate with government for civic initiatives.
u. To promote volunteerism for civic causes.
v. To conduct surveys on civic knowledge.
w. To develop apps for reporting civic violations.`,
  "Health and Welfare": `k. To communicate and coordinate with the Government, Local and public authorities on various issues related to development, welfare and public interest on different issues concerning sanitation and the environment.
l. To create programs for children and their families living in poverty that will provide for their education, healthcare and basic needs, as well as motivation, encouragement, life skills, vocational training, job assistance, linking them to support systems, education on hygiene, disease prevention, budgeting, positive thinking, etc. These programs will work towards progressing families into self-sufficiency.
m. To organize and take up Health, Educational and Welfare programs for Women and children.
n. To organize health camps for underprivileged communities.
o. To promote vaccination drives.
p. To conduct awareness on disease prevention.
q. To support mental health programs.
r. To provide medical aid to the needy.
s. To partner with hospitals for subsidized treatments.
t. To organize blood donation camps.
u. To promote hygiene and sanitation education.
v. To support women's health initiatives.
w. To conduct nutritional programs for mothers and children.`,
  "Poverty Alleviation": `l. To create programs for children and their families living in poverty that will provide for their education, healthcare and basic needs, as well as motivation, encouragement, life skills, vocational training, job assistance, linking them to support systems, education on hygiene, disease prevention, budgeting, positive thinking, etc. These programs will work towards progressing families into self-sufficiency.
m. To organize and take up Health, Educational and Welfare programs for Women and children.
n. To encourage children and their families to find ways to contribute to their community or other individuals in need.
o. To follow and help achieve the objectives of “Swachh Bharath Abhiyan”.
p. To promote a healthier lifestyle amongst the public and to promote voluntary social service by individuals.
q. To advance the cause of education, medical relief, relief to the poor, disaster relief and any other objects of general public utility.
r. To provide food and clothing to the poor.
s. To offer vocational training for income generation.
t. To support microfinance for small businesses.
u. To conduct job placement services.
v. To provide housing assistance.
w. To organize disaster relief efforts.`,
  "Other": `Custom detailed points for trust objects. Please edit as needed.
a. Point 1...
b. Point 2...
c. Point 3...
d. Point 4...
e. Point 5...
f. Point 6...
g. Point 7...
h. Point 8...
i. Point 9...
j. Point 10...
k. Point 11...
l. Point 12...
m. Point 13...
n. Point 14...
o. Point 15...
p. Point 16...
q. Point 17...
r. Point 18...
s. Point 19...
t. Point 20...`,
};
