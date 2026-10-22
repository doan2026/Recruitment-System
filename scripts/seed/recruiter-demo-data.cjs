// Fictional companies and contacts for local development only.
// Role: title, min/max VND per month, experience years, skills, responsibilities, optional type.
const companies = [
  {
    code: 'anviet', brand: 'An Việt Digital', initials: 'AV', color: '#087f46', industry: 'Phát triển phần mềm', size: '51-200', city: 'Hà Nội',
    address: 'Tầng 6, Tòa nhà Demo, đường Duy Tân, phường Cầu Giấy, Hà Nội',
    recruiter: 'Nguyễn Minh Anh', focus: 'nền tảng quản trị doanh nghiệp và sản phẩm SaaS cho doanh nghiệp vừa và nhỏ',
    roles: [
      ['Java Backend Developer', 22000000, 35000000, 2, ['Java', 'Spring Boot', 'PostgreSQL', 'Kafka'], 'Thiết kế REST API, tối ưu truy vấn và xây dựng các dịch vụ quản trị doanh nghiệp.'],
      ['Frontend React Developer', 18000000, 30000000, 2, ['React', 'TypeScript', 'Next.js', 'CSS'], 'Xây dựng giao diện SaaS, cải thiện khả năng truy cập và tối ưu trải nghiệm trên thiết bị di động.'],
      ['QA Automation Engineer', 16000000, 26000000, 1, ['Playwright', 'API Testing', 'SQL', 'CI/CD'], 'Xây dựng kiểm thử tự động cho các luồng nghiệp vụ và phối hợp xử lý lỗi trước mỗi đợt phát hành.'],
      ['DevOps Engineer', 25000000, 40000000, 3, ['Docker', 'Kubernetes', 'Linux', 'Terraform'], 'Vận hành hệ thống CI/CD, theo dõi tài nguyên và nâng cao độ ổn định của hạ tầng.'],
    ],
  },
  {
    code: 'mayxanh', brand: 'Mây Xanh Cloud', initials: 'MX', color: '#2563eb', industry: 'Điện toán đám mây', size: '201-500', city: 'TP. Hồ Chí Minh',
    address: 'Tầng 12, Tòa nhà Demo, đường Nguyễn Văn Linh, phường Tân Hưng, TP. Hồ Chí Minh',
    recruiter: 'Trần Hoàng Nam', focus: 'giải pháp điện toán đám mây, bảo mật và tự động hóa hạ tầng cho khách hàng doanh nghiệp',
    roles: [
      ['Cloud Platform Engineer', 28000000, 45000000, 3, ['AWS', 'Kubernetes', 'Terraform', 'Python'], 'Thiết kế nền tảng cloud, chuẩn hóa hạ tầng bằng mã và tối ưu chi phí vận hành.'],
      ['Site Reliability Engineer', 30000000, 50000000, 3, ['Linux', 'Prometheus', 'Grafana', 'Go'], 'Xây dựng chỉ số SLO, tự động hóa xử lý sự cố và cải thiện tính sẵn sàng của dịch vụ.'],
      ['Node.js Backend Developer', 22000000, 38000000, 2, ['Node.js', 'NestJS', 'Redis', 'PostgreSQL'], 'Phát triển API quản lý tài nguyên cloud, thiết kế hàng đợi tác vụ và kiểm soát truy cập.'],
      ['Security Analyst', 24000000, 38000000, 2, ['SIEM', 'Network Security', 'OWASP', 'Linux'], 'Phân tích cảnh báo bảo mật, rà soát cấu hình và phối hợp khắc phục lỗ hổng.'],
      ['Technical Sales Consultant', 16000000, 28000000, 1, ['B2B Sales', 'Cloud', 'CRM', 'Presentation'], 'Tư vấn giải pháp cloud, thực hiện demo sản phẩm và hỗ trợ xây dựng đề xuất kỹ thuật.'],
    ],
  },
  {
    code: 'luavang', brand: 'Lúa Vàng Commerce', initials: 'LV', color: '#c47d12', industry: 'Thương mại điện tử', size: '51-200', city: 'TP. Hồ Chí Minh',
    address: 'Tầng 4, Văn phòng Demo, đường Điện Biên Phủ, phường Thạnh Mỹ Tây, TP. Hồ Chí Minh',
    recruiter: 'Lê Thùy Linh', focus: 'nền tảng bán lẻ trực tuyến và giải pháp kết nối các thương hiệu Việt với người tiêu dùng',
    roles: [
      ['Digital Marketing Specialist', 14000000, 22000000, 2, ['Google Ads', 'Meta Ads', 'Google Analytics', 'SEO'], 'Lập kế hoạch chiến dịch đa kênh, theo dõi hiệu quả chuyển đổi và tối ưu chi phí quảng cáo.'],
      ['E-commerce Operations Executive', 12000000, 20000000, 1, ['E-commerce', 'Excel', 'Inventory', 'Customer Service'], 'Quản lý gian hàng, phối hợp xử lý đơn hàng và cải thiện chất lượng vận hành sàn thương mại điện tử.'],
      ['Business Data Analyst', 18000000, 30000000, 2, ['SQL', 'Power BI', 'Python', 'Statistics'], 'Phân tích hành vi mua hàng, xây dựng dashboard kinh doanh và đề xuất cải thiện tỷ lệ chuyển đổi.'],
    ],
  },
  {
    code: 'bacnam', brand: 'Bắc Nam Logistics', initials: 'BN', color: '#0f7695', industry: 'Logistics và chuỗi cung ứng', size: '201-500', city: 'Hải Phòng',
    address: 'Tầng 3, Trung tâm Demo Logistics, đường Lê Hồng Phong, phường Hải An, Hải Phòng',
    recruiter: 'Phạm Đức Huy', focus: 'dịch vụ kho vận, giao nhận và quản lý chuỗi cung ứng thông minh cho khách hàng trong nước',
    roles: [
      ['Logistics Coordinator', 13000000, 21000000, 1, ['Logistics', 'Excel', 'Documentation', 'English'], 'Điều phối kế hoạch giao nhận, theo dõi tiến độ vận chuyển và xử lý các tình huống phát sinh.'],
      ['Sales Logistics Executive', 14000000, 24000000, 2, ['B2B Sales', 'Logistics', 'CRM', 'Negotiation'], 'Phát triển khách hàng doanh nghiệp, xây dựng báo giá và chăm sóc hợp đồng vận tải.'],
      ['Warehouse Team Leader', 17000000, 26000000, 3, ['Warehouse', 'WMS', 'Leadership', 'Safety'], 'Tổ chức ca làm việc, kiểm soát tồn kho và cải tiến quy trình nhập xuất hàng hóa.'],
      ['Supply Chain Analyst', 18000000, 28000000, 2, ['SQL', 'Power BI', 'Supply Chain', 'Excel'], 'Phân tích năng suất kho và tuyến vận tải, dự báo nhu cầu và đề xuất phương án tối ưu.'],
    ],
  },
  {
    code: 'saomai', brand: 'Sao Mai Learning', initials: 'SM', color: '#7c3aed', industry: 'Giáo dục và công nghệ', size: '51-200', city: 'Hà Nội',
    address: 'Tầng 5, Tòa nhà Demo Education, đường Nguyễn Chánh, phường Yên Hòa, Hà Nội',
    recruiter: 'Vũ Ngọc Hà', focus: 'sản phẩm học tập trực tuyến và các chương trình phát triển kỹ năng dành cho học sinh, sinh viên',
    roles: [
      ['English Curriculum Specialist', 16000000, 26000000, 2, ['English', 'Curriculum Design', 'TESOL', 'LMS'], 'Thiết kế học liệu tiếng Anh, đánh giá chất lượng nội dung và cải tiến lộ trình học tập.'],
      ['Learning Support Executive', 10000000, 16000000, 0, ['Customer Service', 'Communication', 'CRM', 'LMS'], 'Hỗ trợ học viên sử dụng nền tảng, phối hợp giải quyết yêu cầu và theo dõi mức độ hài lòng.'],
      ['UI/UX Product Designer', 18000000, 30000000, 2, ['Figma', 'User Research', 'Prototyping', 'Design Systems'], 'Nghiên cứu trải nghiệm học viên và thiết kế giao diện dễ tiếp cận cho các sản phẩm học tập.'],
      ['Java Developer Intern', 5000000, 8000000, 0, ['Java', 'Spring Boot', 'Git', 'SQL'], 'Tham gia phát triển tính năng dưới sự hướng dẫn của mentor, viết kiểm thử và tài liệu kỹ thuật.', 'INTERNSHIP'],
      ['Fullstack TypeScript Developer', 20000000, 34000000, 2, ['TypeScript', 'React', 'Node.js', 'PostgreSQL'], 'Phát triển luồng học trực tuyến từ giao diện đến API và tích hợp công cụ hỗ trợ giáo viên.', 'REMOTE'],
    ],
  },
  {
    code: 'anhduong', brand: 'Ánh Dương Health', initials: 'AD', color: '#d44571', industry: 'Công nghệ chăm sóc sức khỏe', size: '51-200', city: 'Đà Nẵng',
    address: 'Tầng 7, Trung tâm Demo Health, đường Nguyễn Văn Linh, phường Hải Châu, Đà Nẵng',
    recruiter: 'Đặng Thanh Tâm', focus: 'phần mềm quản lý lịch hẹn, vận hành cơ sở chăm sóc sức khỏe và trải nghiệm khách hàng',
    roles: [
      ['Healthcare Operations Executive', 12000000, 20000000, 1, ['Operations', 'Customer Service', 'Excel', 'Process Improvement'], 'Theo dõi lịch hẹn, chuẩn hóa quy trình tiếp nhận và phối hợp nâng cao chất lượng dịch vụ.'],
      ['Data Engineer', 24000000, 38000000, 3, ['Python', 'SQL', 'Airflow', 'PostgreSQL'], 'Xây dựng pipeline dữ liệu vận hành, quản lý chất lượng dữ liệu và tuân thủ quy tắc bảo mật truy cập.'],
      ['Flutter Mobile Developer', 20000000, 32000000, 2, ['Flutter', 'Dart', 'REST API', 'Firebase'], 'Phát triển ứng dụng đặt lịch, tối ưu hiệu năng và phối hợp kiểm thử trên Android, iOS.'],
    ],
  },
  {
    code: 'thanhphoxanh', brand: 'Thành Phố Xanh Energy', initials: 'TX', color: '#438126', industry: 'Năng lượng tái tạo', size: '201-500', city: 'TP. Hồ Chí Minh',
    address: 'Tầng 8, Tòa nhà Demo Green, đường Phạm Văn Đồng, phường Hiệp Bình, TP. Hồ Chí Minh',
    recruiter: 'Bùi Gia Bảo', focus: 'giải pháp năng lượng mặt trời và nền tảng theo dõi hiệu quả sử dụng năng lượng cho doanh nghiệp',
    roles: [
      ['Solar Design Engineer', 18000000, 30000000, 2, ['AutoCAD', 'PVsyst', 'Electrical Design', 'Solar'], 'Khảo sát yêu cầu kỹ thuật và thiết kế phương án hệ thống điện mặt trời phù hợp cho khách hàng.'],
      ['Electrical Project Coordinator', 20000000, 32000000, 3, ['Project Management', 'Electrical Engineering', 'Safety', 'AutoCAD'], 'Theo dõi tiến độ triển khai, phối hợp nhà thầu và kiểm soát hồ sơ chất lượng dự án.'],
      ['IoT Software Engineer', 22000000, 36000000, 2, ['C++', 'Python', 'MQTT', 'IoT'], 'Phát triển giải pháp thu thập dữ liệu thiết bị và giám sát hiệu suất hệ thống năng lượng.'],
      ['Sustainability Content Specialist', 14000000, 22000000, 1, ['Content Writing', 'SEO', 'Research', 'Sustainability'], 'Xây dựng nội dung về giải pháp tiết kiệm năng lượng và truyền thông các dự án của công ty.'],
    ],
  },
  {
    code: 'netviet', brand: 'Nét Việt Studio', initials: 'NV', color: '#c25630', industry: 'Thiết kế và truyền thông sáng tạo', size: '11-50', city: 'Hà Nội',
    address: 'Tầng 3, Không gian Demo Creative, đường Thái Hà, phường Đống Đa, Hà Nội',
    recruiter: 'Đỗ Mai Phương', focus: 'thiết kế thương hiệu, trải nghiệm số và sản xuất nội dung truyền thông cho các nhãn hàng Việt',
    roles: [
      ['Product Designer', 20000000, 32000000, 3, ['Figma', 'UI Design', 'User Research', 'Prototyping'], 'Thiết kế sản phẩm số, tổ chức nghiên cứu người dùng và xây dựng hệ thống component dùng chung.'],
      ['Graphic Designer', 13000000, 22000000, 1, ['Illustrator', 'Photoshop', 'Branding', 'Typography'], 'Phát triển bộ nhận diện và thiết kế các ấn phẩm truyền thông trên nền tảng số.'],
      ['Motion Designer', 16000000, 26000000, 2, ['After Effects', 'Premiere', 'Animation', 'Storyboarding'], 'Xây dựng storyboard và sản xuất chuyển động phục vụ video giới thiệu, chiến dịch thương hiệu.'],
      ['Creative Frontend Developer', 18000000, 30000000, 2, ['React', 'TypeScript', 'CSS', 'Accessibility'], 'Triển khai website thương hiệu, kết hợp hiệu ứng hợp lý với trải nghiệm và hiệu năng tốt.', 'REMOTE'],
      ['Account Executive', 12000000, 20000000, 1, ['Client Service', 'Presentation', 'Planning', 'Communication'], 'Tiếp nhận yêu cầu khách hàng, điều phối tiến độ sáng tạo và theo dõi chất lượng bàn giao.'],
    ],
  },
  {
    code: 'songhan', brand: 'Sông Hàn Travel', initials: 'SH', color: '#0284a8', industry: 'Du lịch và dịch vụ', size: '51-200', city: 'Đà Nẵng',
    address: 'Tầng 2, Trung tâm Demo Travel, đường Trần Phú, phường Hải Châu, Đà Nẵng',
    recruiter: 'Hoàng Hải Yến', focus: 'dịch vụ du lịch trải nghiệm, tổ chức hành trình doanh nghiệp và sản phẩm đặt dịch vụ trực tuyến',
    roles: [
      ['Tour Operations Executive', 12000000, 20000000, 1, ['Tour Operations', 'English', 'Planning', 'Customer Service'], 'Điều phối lịch trình, phối hợp đối tác địa phương và hỗ trợ khách hàng trước, trong chuyến đi.'],
      ['Corporate Travel Consultant', 14000000, 24000000, 2, ['B2B Sales', 'Tourism', 'CRM', 'Negotiation'], 'Tư vấn chương trình du lịch doanh nghiệp và xây dựng phương án dịch vụ theo ngân sách khách hàng.'],
      ['React Native Developer', 20000000, 34000000, 2, ['React Native', 'TypeScript', 'REST API', 'Mobile Testing'], 'Phát triển ứng dụng đặt dịch vụ, quản lý hành trình và thông báo trạng thái cho khách hàng.'],
    ],
  },
  {
    code: 'binhminh', brand: 'Bình Minh Foods', initials: 'BM', color: '#bc6630', industry: 'Thực phẩm và hàng tiêu dùng', size: '201-500', city: 'Cần Thơ',
    address: 'Tầng 4, Trung tâm Demo Foods, đường 30 Tháng 4, phường Ninh Kiều, Cần Thơ',
    recruiter: 'Trương Quốc Khánh', focus: 'sản phẩm thực phẩm chế biến và chuỗi phân phối hàng tiêu dùng phục vụ thị trường trong nước',
    roles: [
      ['Food Quality Assurance Specialist', 14000000, 22000000, 2, ['HACCP', 'ISO 22000', 'Quality Assurance', 'Documentation'], 'Theo dõi quy trình chất lượng, kiểm tra hồ sơ và phối hợp xử lý các điểm không phù hợp.'],
      ['Procurement Executive', 13000000, 21000000, 1, ['Procurement', 'Excel', 'Negotiation', 'Supply Chain'], 'Tìm kiếm nhà cung cấp, theo dõi đơn mua hàng và phối hợp bảo đảm tiến độ cung ứng.'],
      ['FMCG Sales Supervisor', 18000000, 30000000, 3, ['FMCG', 'Sales Management', 'Distribution', 'Leadership'], 'Quản lý đội ngũ bán hàng, phát triển điểm bán và theo dõi chỉ tiêu phân phối theo khu vực.'],
      ['General Accountant', 14000000, 24000000, 2, ['Accounting', 'Excel', 'ERP', 'Financial Reporting'], 'Tổng hợp chứng từ, đối chiếu công nợ và lập báo cáo quản trị phục vụ hoạt động kinh doanh.'],
    ],
  },
];

module.exports = companies.map((item, index) => ({
  ...item,
  name: `${item.brand} (Demo)`,
  email: `recruiter${String(index + 1).padStart(2, '0')}@demo.careerhub.test`,
  phone: `09000001${String(index + 1).padStart(2, '0')}`,
  website: `https://${item.code}.example`,
  taxCode: `DEMO20261022${String(index + 1).padStart(2, '0')}`,
  description: `${item.brand} phát triển ${item.focus}. Đội ngũ làm việc tại ${item.city}, đề cao chất lượng sản phẩm, tinh thần hợp tác và những cải tiến có thể đo lường.\n\nChúng tôi xây dựng môi trường minh bạch, có kế hoạch hướng dẫn nhân sự mới, trao đổi mục tiêu định kỳ và cơ hội phát triển chuyên môn. Các phòng ban phối hợp theo kế hoạch cụ thể, đánh giá công việc dựa trên kết quả và khuyến khích chia sẻ kiến thức.\n\nQuyền lợi: lương theo năng lực, thưởng theo kết quả, bảo hiểm theo quy định, 12 ngày phép/năm, ngân sách đào tạo và hoạt động gắn kết đội ngũ. Quy trình tuyển dụng gồm trao đổi với nhân sự, đánh giá chuyên môn và thống nhất đề nghị làm việc.\n\nĐây là doanh nghiệp hư cấu phục vụ kiểm thử CareerHub local. Tên người liên hệ, điện thoại, mã số thuế và website là dữ liệu mẫu; ảnh là hình minh họa, không phải thông tin doanh nghiệp đã được xác thực ngoài đời thực.`,
}));
