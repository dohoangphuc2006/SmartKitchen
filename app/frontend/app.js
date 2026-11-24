"use strict";

const ui = {
  form: document.getElementById("analyzeForm"),
  input: document.getElementById("imageInput"),
  dropzone: document.getElementById("dropzone"),
  placeholder: document.getElementById("dropPlaceholder"),
  previewWrap: document.getElementById("previewWrap"),
  preview: document.getElementById("imagePreview"),
  fileRow: document.getElementById("fileRow"),
  fileName: document.getElementById("fileName"),
  remove: document.getElementById("removeButton"),
  button: document.getElementById("analyzeButton"),
  buttonLabel: document.getElementById("buttonLabel"),
  status: document.getElementById("statusRegion"),
  results: document.getElementById("results"),
  ingredientList: document.getElementById("ingredientList"),
  ingredientCount: document.getElementById("ingredientCount"),
  recipeList: document.getElementById("recipeList"),
  mappingNote: document.getElementById("mappingNote"),
  timing: document.getElementById("resultTiming"),
  maxFileLabel: document.getElementById("maxFileLabel"),
};

let appConfig = null;
let selectedFile = null;
let previewUrl = null;
let isLoading = false;
// Static CPU analysis includes upload, inference/queueing and JSON body reading.
const ACTION_DEADLINES_MS = Object.freeze({analyze: 120000, recommend: 30000});
let activeActionRequest = null;
let actionRequestSequence = 0;
let localizationData = {ingredients: {}, recipe_titles: {}, manual_aliases: {}, ambiguous_inputs: []};
let diacriticFreeAliases = {};
const globalI18n = typeof SmartKitchenI18N !== 'undefined' ? SmartKitchenI18N : null;
let currentLocale = globalI18n?.locale || 'vi';
let displayCatalog = {recipes: {}, coverage: {}};
let displayTitlesByName = {};
let liveDetection = null;
let stillOverlay = null;
let liveOverlay = null;
let lastLiveMetrics = null;
let diagnosticExporter = null;
let lastDetectionAudit = null;
const guardReview = document.getElementById('guardReview');
const recipeFirst = () => appConfig?.recipe_first === true;
const canDetectImages = () => Boolean(appConfig && (!recipeFirst() || appConfig.image_detection_available));
const precisionGuard = () => appConfig?.scope?.profile === 'fridge30_precision_guard';
const needsConfirmation = () => appConfig?.scope?.profile === 'fridge30_experimental' || precisionGuard();
const guardEmptyMessage = () => currentLocale === 'en'
  ? 'No ingredients could be identified with confidence' : 'Chưa xác định chắc chắn nguyên liệu trong ảnh';

// Curated Vietnamese & diacritic-free aliases + verified 526-item catalog for Manual-First input.
const EXTRA_VI_ALIASES = Object.freeze({"trứng":"egg","trung":"egg","trứng gà":"egg","trung ga":"egg","quả trứng":"egg","qua trung":"egg","cà chua":"tomato","ca chua":"tomato","quả cà chua":"tomato","qua ca chua":"tomato","thịt gà":"chicken","thit ga":"chicken","gà":"chicken","ga":"chicken","thịt gà sống":"chicken","ức gà":"chicken breast","uc ga":"chicken breast","thịt ức gà":"chicken breast","thit uc ga":"chicken breast","thịt bò xay":"ground beef","thit bo xay":"ground beef","bò xay":"ground beef","bo xay":"ground beef","thịt bò băm":"ground beef","thit bo bam":"ground beef","bò băm":"ground beef","bo bam":"ground beef","thịt heo băm":"ground pork","thit heo bam":"ground pork","thịt heo xay":"ground pork","thit heo xay":"ground pork","thịt lợn xay":"ground pork","thit lon xay":"ground pork","thịt lợn băm":"ground pork","thit lon bam":"ground pork","heo băm":"ground pork","heo bam":"ground pork","heo xay":"ground pork","thịt ba rọi":"pork belly","thit ba roi":"pork belly","thịt ba chỉ":"pork belly","thit ba chi":"pork belly","ba rọi":"pork belly","ba roi":"pork belly","ba chỉ":"pork belly","ba chi":"pork belly","sườn heo":"pork ribs","suon heo":"pork ribs","sườn lợn":"pork ribs","suon lon":"pork ribs","sườn non":"pork ribs","suon non":"pork ribs","thịt sườn":"pork ribs","thit suon":"pork ribs","hành tây":"onion","hanh tay":"onion","củ hành tây":"onion","cu hanh tay":"onion","hành lá":"green onion","hanh la":"green onion","nhánh hành lá":"green onion","nhanh hanh la":"green onion","hành tím":"shallot","hanh tim":"shallot","hành khô":"shallot","hanh kho":"shallot","củ hành tím":"shallot","tỏi":"garlic","toi":"garlic","củ tỏi":"garlic","cu toi":"garlic","tép tỏi":"garlic","tep toi":"garlic","tỏi băm":"garlic","toi bam":"garlic","gừng":"ginger","gung":"ginger","củ gừng":"ginger","cu gung":"ginger","nhánh gừng":"ginger","nhanh gung":"ginger","cơm nguội":"cooked rice","com nguoi":"cooked rice","cơm trắng":"cooked rice","com trang":"cooked rice","cơm chín":"cooked rice","com chin":"cooked rice","khoai tây":"potato","khoai tay":"potato","củ khoai tây":"potato","cu khoai tay":"potato","khoai lang":"sweet potato","củ khoai lang":"sweet potato","cu khoai lang":"sweet potato","cà rốt":"carrot","ca rot":"carrot","củ cà rốt":"carrot","cu ca rot":"carrot","nấm":"mushroom","nam":"mushroom","nấm tươi":"mushroom","nam tuoi":"mushroom","nấm mèo":"dried wood ear mushroom","nam meo":"dried wood ear mushroom","mộc nhĩ":"dried wood ear mushroom","moc nhi":"dried wood ear mushroom","tôm":"shrimp","tom":"shrimp","tôm tươi":"shrimp","tom tuoi":"shrimp","tôm bóc vỏ":"shrimp peeled deveined","tom boc vo":"shrimp peeled deveined","tôm tươi bóc vỏ":"shrimp peeled deveined","mực":"squid","muc":"squid","mực tươi":"squid","muc tuoi":"squid","mực ống":"squid","muc ong":"squid","sữa":"milk","sua":"milk","sữa tươi":"milk","sua tuoi":"milk","bơ":"butter","bơ sữa":"butter","bo sua":"butter","bơ lạt":"unsalted butter","bo lat":"unsalted butter","phô mai":"cheese","pho mai":"cheese","phô-mát":"cheese","pho mat":"cheese","phô mai dê":"goat cheese","pho mai de":"goat cheese","bánh mì":"bread","banh mi":"bread","bánh mỳ":"bread","banh my":"bread","bột mì":"flour","bot mi":"flour","bột mì đa dụng":"all-purpose flour","bot mi da dung":"all-purpose flour","đường":"sugar","duong":"sugar","muối":"salt","muoi":"salt","tiêu":"pepper","tieu":"pepper","tiêu xay":"ground black pepper","tieu xay":"ground black pepper","hạt tiêu":"pepper","hat tieu":"pepper","nước mắm":"fish sauce","nuoc mam":"fish sauce","nước tương":"soy sauce","nuoc tuong":"soy sauce","xì dầu":"soy sauce","xi dau":"soy sauce","dầu hào":"oyster sauce","dau hao":"oyster sauce","dầu ăn":"vegetable oil","dau an":"vegetable oil","dầu thực vật":"vegetable oil","dau thuc vat":"vegetable oil","dầu ô liu":"olive oil","dau o liu":"olive oil","chanh xanh":"lime","quả chanh xanh":"lime","qua chanh xanh":"lime","chanh":"lime","chanh vàng":"lemon","chanh vang":"lemon","rau chân vịt":"spinach","rau chan vit":"spinach","cải bó xôi":"spinach","cai bo xoi":"spinach","rau bina":"spinach","bông cải xanh":"broccoli","bong cai xanh":"broccoli","súp lơ xanh":"broccoli","sup lo xanh":"broccoli","bắp cải":"cabbage","bap cai":"cabbage","cải bắp":"cabbage","cai bap":"cabbage","cải thìa":"bok choy","cai thia":"bok choy","rau cải thìa":"bok choy","dưa leo":"cucumber","dua leo":"cucumber","dưa chuột":"cucumber","dua chuot":"cucumber","ớt chuông":"bell pepper","ot chuong":"bell pepper","ớt chuông đỏ":"red bell pepper","ot chuong do":"red bell pepper","ớt hiểm":"thai chile","ot hiem":"thai chile","sả":"lemongrass","sa":"lemongrass","cây sả":"lemongrass","cay sa":"lemongrass","ngò rí":"cilantro","ngo ri":"cilantro","rau mùi":"cilantro","rau mui":"cilantro","ngò":"cilantro","đậu cô ve":"green bean","dau co ve":"green bean","đậu que":"green bean","dau que":"green bean","ngô":"corn","bắp":"corn","bap":"corn","bắp ngô":"corn","bap ngo":"corn","táo":"apple","tao":"apple","chuối":"banana","chuoi":"banana","dâu tây":"strawberry","dau tay":"strawberry","việt quất":"blueberry","viet quat":"blueberry","mì trứng":"egg noodle","mi trung":"egg noodle","trứng cút":"quail egg","trung cut":"quail egg","giăm bông":"ham","giam bong":"ham","kem béo":"heavy cream","kem beo":"heavy cream","thịt gà chặt miếng":"chicken","gà chặt miếng":"chicken","gà ta":"chicken","ức gà phi lê":"chicken breast","phi lê ức gà":"chicken breast","ức gà rút xương bỏ da":"boneless skinless chicken breast","ức gà không xương không da":"boneless skinless chicken breast","ức gà phi lê không da":"boneless skinless chicken breast","đùi gà rút xương bỏ da":"skinless boneless chicken thigh","thịt đùi gà rút xương":"skinless boneless chicken thigh","đùi gà phi lê":"skinless boneless chicken thigh","đùi gà":"chicken thigh","thịt đùi gà":"chicken thigh","má đùi gà":"chicken thigh","đùi gà nguyên xương có da":"bone-in skin-on chicken thigh","đùi gà có xương có da":"bone-in skin-on chicken thigh","cánh gà":"chicken wing","cánh gà tươi":"chicken wing","đùi tỏi gà":"chicken drumstick","tỏi gà":"chicken drumstick","đùi gà tỏi":"chicken drumstick","đùi gà nguyên chiếc":"chicken legs","chân đùi gà":"chicken legs","góc tư đùi gà":"chicken legs","thăn nội gà":"chicken tenders","phi lê gà non":"chicken tenders","thăn gà":"chicken tenders","gan gà":"chicken livers","gan gà tươi":"chicken livers","gà nguyên con":"whole chicken","cả con gà":"whole chicken","gà nguyên chiếc":"whole chicken","thịt gà chín":"cooked chicken","thịt gà luộc":"cooked chicken","gà xé":"cooked chicken","gà quay chín":"cooked chicken","thịt gà xay":"ground chicken","gà xay":"ground chicken","thịt gà băm":"ground chicken","gà băm":"ground chicken","thịt nạc vai bò xay":"ground beef chuck","nạc vai bò xay":"ground beef chuck","bò chuck xay":"ground beef chuck","thịt nạc vai bò":"beef chuck","nạc vai bò":"beef chuck","bắp bò nạc vai":"beef chuck","thịt bò hầm":"beef chuck","thịt nạc vai bò rút xương":"boneless beef chuck","nạc vai bò không xương":"boneless beef chuck","thịt thăn ngoại bò xay":"ground sirloin","thăn bò xay":"ground sirloin","bò sirloin xay":"ground sirloin","thăn nội bò":"beef tenderloin","thăn bò":"beef tenderloin","phi lê bò":"beef tenderloin","thịt thăn bò":"beef tenderloin","thăn bụng bò":"flank steak","thịt bò flank":"flank steak","thịt dẻ sườn bụng bò":"flank steak","thịt diềm thăn bò":"skirt steak","diềm thăn bò":"skirt steak","bò skirt steak":"skirt steak","thăn ngoại bò":"sirloin steak","bò bít tết sirloin":"sirloin steak","thịt thăn lưng bò":"sirloin steak","thăn lưng bò ribeye":"rib-eye steak","bò ribeye":"rib-eye steak","thịt bò mắt sườn":"rib-eye steak","thăn ngoại bò new york":"new york strip steak","bò strip steak":"new york strip steak","thăn bò new york":"new york strip steak","ức bò":"beef brisket","gầu bò":"beef brisket","thịt ức bò":"beef brisket","nạm bò":"beef brisket","sườn non bò":"beef short ribs","sườn bò":"beef short ribs","sườn bò có xương":"beef short ribs","sườn bò rút xương":"boneless beef short ribs","sườn non bò không xương":"boneless beef short ribs","thịt bò muối":"corned beef","bò muối corned beef":"corned beef","lợn xay":"ground pork","lợn băm":"ground pork","thịt băm":"ground pork","thịt xay":"ground pork","thịt nạc vai heo xay":"ground pork shoulder","nạc vai xay":"ground pork shoulder","thịt nạc vai xay":"ground pork shoulder","nạc vai lợn xay":"ground pork shoulder","nạc dăm xay":"ground pork shoulder","thịt nạc vai lợn xay":"ground pork shoulder","thịt ba rọi heo":"pork belly","thịt ba chỉ lợn":"pork belly","ba chỉ heo":"pork belly","sườn heo non":"pork ribs","thăn nội heo":"pork tenderloin","thăn heo":"pork tenderloin","thăn lợn":"pork tenderloin","thịt thăn heo":"pork tenderloin","thăn lưng heo rút xương":"boneless pork loin","thăn lưng heo":"boneless pork loin","thịt cốt lết không xương":"boneless pork loin","thịt nạc vai heo":"pork shoulder","nạc vai heo":"pork shoulder","nạc dăm heo":"pork shoulder","vai heo":"pork shoulder","nạc vai heo rút xương":"boneless pork shoulder","vai heo không xương":"boneless pork shoulder","sườn cốt lết heo":"bone-in pork chops","cốt lết heo":"bone-in pork chops","thịt cốt lết":"bone-in pork chops","sườn cốt lết":"bone-in pork chops","thịt xông khói":"bacon","ba rọi xông khói":"bacon","thịt ba chỉ xông khói":"bacon","thịt xông khói cắt dày":"thick-cut bacon","ba rọi xông khói lát dày":"thick-cut bacon","thịt xông khói nguyên tảng":"slab bacon","ba rọi xông khói nguyên khối":"slab bacon","thịt ba chỉ muối ý pancetta":"pancetta","thịt muối pancetta":"pancetta","ba rọi muối ý":"pancetta","đùi heo muối ý prosciutto":"prosciutto","thịt nguội prosciutto":"prosciutto","giăm bông ý":"prosciutto","thịt nguội":"ham","thịt giăm bông":"ham","chả lụa âu":"ham","giăm bông chín":"cooked ham","thịt nguội chín":"cooked ham","giăm bông thái lát":"cooked ham","giăm bông muối kiểu mỹ":"country ham","đùi heo muối kiểu mỹ":"country ham","lạp xưởng":"chinese sausage","cây lạp xưởng":"chinese sausage","lạp sườn":"chinese sausage","xúc xích ý vị ngọt":"sweet italian sausage","xúc xích ý":"sweet italian sausage","xúc xích heo kiểu ý":"sweet italian sausage","xúc xích ý vị cay":"hot italian sausage","xúc xích ý cay":"hot italian sausage","xúc xích hun khói andouille":"andouille sausage","xúc xích andouille":"andouille sausage","xúc xích chorizo":"chorizo","xúc xích cay chorizo":"chorizo","xúc xích khô tây ban nha chorizo":"spanish chorizo","xúc xích chorizo tây ban nha":"spanish chorizo","thịt gà tây xay":"ground turkey","gà tây xay":"ground turkey","gà tây băm":"ground turkey","thịt gà tây":"turkey","gà tây":"turkey","thịt gà tây chín":"cooked turkey","gà tây quay chín":"cooked turkey","thịt cừu xay":"ground lamb","cừu xay":"ground lamb","thịt cừu băm":"ground lamb","đùi cừu rút xương":"boneless leg of lamb","thịt đùi cừu không xương":"boneless leg of lamb","sườn cừu tảng":"rib lamb chops","sườn cừu":"rib lamb chops","dẻ sườn cừu":"rib lamb chops","đùi cừu hầm":"rib lamb chops","thịt vai cừu":"boneless lamb shoulder","nạc vai cừu":"boneless lamb shoulder","thịt vịt":"duck","vịt":"duck","vịt nguyên con":"duck","ức vịt":"duck breast","thịt ức vịt":"duck breast","phi lê ức vịt":"duck breast","đùi vịt":"duck legs","thịt đùi vịt":"duck legs","thịt bê xay":"ground veal","bê xay":"ground veal","thịt bê băm":"ground veal","tôm tươi bóc vỏ":"shrimp","tôm sú":"shrimp","tôm thẻ":"shrimp","tôm bóc vỏ rút chỉ":"shrimp peeled deveined","tôm làm sạch bóc vỏ":"shrimp peeled deveined","tôm nõn làm sạch":"shrimp peeled deveined","tôm nguyên vỏ":"shrimp in shell","tôm còn vỏ":"shrimp in shell","tôm tươi nguyên vỏ":"shrimp in shell","tôm cỡ lớn":"jumbo shrimp","tôm to":"jumbo shrimp","tôm sú lớn":"jumbo shrimp","tôm chín":"cooked shrimp","tôm luộc chín":"cooked shrimp","tôm hấp chín":"cooked shrimp","tôm khô":"dried shrimp","tôm nõn khô":"dried shrimp","mực lá":"squid","bạch tuộc":"octopus","bạch tuộc tươi":"octopus","cá hồi":"salmon","cá hồi tươi":"salmon","thịt cá hồi":"salmon","phi lê cá hồi":"salmon fillet","cá hồi phi lê":"salmon fillet","miếng cá hồi phi lê":"salmon fillet","phi lê cá hồi bỏ da":"skinless salmon fillet","cá hồi phi lê không da":"skinless salmon fillet","cá hồi xông khói":"smoked salmon","cá hồi hun khói":"smoked salmon","cá tuyết":"cod fillet","cá tuyết tươi":"cod fillet","phi lê cá tuyết":"cod fillet","phi lê cá bơn halibut":"halibut fillet","cá bơn":"halibut fillet","phi lê cá bơn":"halibut fillet","cá vược biển (cá chẽm)":"sea bass fillet with skin","cá chẽm":"sea bass fillet with skin","cá vược":"sea bass fillet with skin","phi lê cá chẽm":"sea bass fillet with skin","cá hồi vân trout":"smoked trout","cá hồi suối":"smoked trout","phi lê cá trout":"smoked trout","cá trout xông khói":"smoked trout","cá ngừ tươi":"tuna steak","cá ngừ":"tuna steak","phi lê cá ngừ":"tuna steak","cá ngừ đóng hộp":"tuna in olive oil","cá ngừ ngâm dầu":"tuna in olive oil","cá ngừ hộp":"tuna in olive oil","cá kiếm cắt lát":"swordfish steak","cá kiếm":"swordfish steak","phi lê cá kiếm":"swordfish steak","cá hồng":"snapper fillet","cá hồng biển":"snapper fillet","phi lê cá hồng":"snapper fillet","phi lê cá da trơn":"catfish fillet","cá trê phi lê":"catfish fillet","cá basa phi lê":"catfish fillet","cá tra phi lê":"catfish fillet","cá da trơn":"catfish fillet","phi lê cá rô phi":"tilapia fillet","cá rô phi":"tilapia fillet","cá điêu hồng phi lê":"tilapia fillet","cá trích / cá mòi":"sardine","cá mòi":"sardine","cá trích tươi":"sardine","phi lê cá cơm muối":"anchovy fillet","cá cơm anchovy":"anchovy fillet","cá cơm ngâm dầu":"anchovy fillet","cá cơm muối":"anchovy fillet","sốt cá cơm nghiền":"anchovy paste","mắm cá cơm nghiền":"anchovy paste","bột nhão cá cơm":"anchovy paste","sò điệp":"sea scallop","cồi sò điệp":"sea scallop","sò điệp biển":"sea scallop","sò điệp tươi":"sea scallop","ngêu / nghêu":"littleneck clam","ngêu":"littleneck clam","nghêu":"littleneck clam","ngao":"littleneck clam","nghêu tươi":"littleneck clam","vẹm biển":"mussel","vẹm":"mussel","con vẹm":"mussel","vẹm xanh":"mussel","hàu":"oyster","hàu tươi":"oyster","ruột hàu":"oyster","con hàu":"oyster","thịt cua bóc sẵn":"lump crabmeat","thịt cua":"lump crabmeat","thịt ghẹ":"lump crabmeat","cua bóc thịt":"lump crabmeat","tôm hùm":"live lobster","tôm hùm tươi":"live lobster","thịt tôm hùm":"live lobster","quả trứng gà":"egg","trứng tươi":"egg","lòng đỏ trứng":"egg yolk","lòng đỏ trứng gà":"egg yolk","lòng trắng trứng":"egg white","lòng trắng trứng gà":"egg white","trứng luộc chín":"hard-boiled egg","trứng gà luộc":"hard-boiled egg","quả trứng cút":"quail egg","trứng chim cút":"quail egg","đậu phụ cứng":"firm tofu","đậu hũ cứng":"firm tofu","đậu phụ chắc":"firm tofu","đậu khuôn":"firm tofu","đậu phụ ép chắc":"extra-firm tofu","đậu hũ ép chắc":"extra-firm tofu","đậu phụ chiên":"extra-firm tofu","đậu hũ non":"silken tofu","đậu phụ non":"silken tofu","đậu phụ lụa":"silken tofu","tàu hũ non":"silken tofu","trái cà chua":"tomato","cà chua tươi":"tomato","cà chua bi":"cherry tomato","cà chua cherry":"cherry tomato","quả cà chua bi":"cherry tomato","cà chua bi dài":"grape tomato","cà chua nho":"grape tomato","cà chua múi":"plum tomato","cà chua plum":"plum tomato","cà chua roma":"plum tomato","cà chua cổ điển nhiều màu":"heirloom tomato","cà chua heirloom":"heirloom tomato","cà chua quả lớn beefsteak":"beefsteak tomato","cà chua to cắt lát":"beefsteak tomato","cà chua đóng hộp nguyên quả":"tomato in juice","cà chua hộp ngâm nước ép":"tomato in juice","hành tây tím":"red onion","hành tây đỏ":"red onion","củ hành tây tím":"red onion","hành tây trắng":"white onion","củ hành tây trắng":"white onion","hành tây vàng":"yellow onion","củ hành tây vàng":"yellow onion","hành tây ngọt":"sweet onion","hành tây vidalia":"sweet onion","hành tây bi":"pearl onion","củ hành bi":"pearl onion","hành tây tím ngâm chua":"pickled red onion","hành tím muối chua":"pickled red onion","tỏi tây":"leek","hành boa-rô":"leek","hành boa rô":"leek","boa rô":"leek","cây tỏi tây":"leek","hành baro":"leek","cà rốt bao tử":"baby carrot","cà rốt non":"baby carrot","cà rốt baby":"baby carrot","khoai tây russet":"russet potato","khoai tây vỏ nâu bở":"russet potato","khoai tây yukon gold":"yukon gold potato","khoai tây vàng yukon":"yukon gold potato","khoai tây vàng":"yukon gold potato","khoai tây vỏ đỏ":"red potato","khoai tây đỏ":"red potato","khoai tây ít bở":"waxy potato","khoai tây dẻo ít bở":"waxy potato","khoai tây sáp":"waxy potato","khoai lang sống":"sweet potato","khoai lang mật":"sweet potato","nấm mỡ":"mushroom","nấm mỡ trắng":"button mushroom","nấm nút":"button mushroom","nấm trắng tròn":"button mushroom","nấm mỡ nâu":"crimini mushroom","nấm crimini":"crimini mushroom","nấm cremini":"crimini mushroom","nấm hương":"shiitake mushroom","nấm đông cô":"shiitake mushroom","nấm hương tươi":"shiitake mushroom","nấm đông cô tươi":"shiitake mushroom","nấm shiitake":"shiitake mushroom","nấm portobello cỡ lớn":"portobello mushroom","nấm portobello":"portobello mushroom","nấm thông khô porcini":"dried porcini mushroom","nấm porcini khô":"dried porcini mushroom","nấm mèo khô":"dried wood ear mushroom","mộc nhĩ khô":"dried wood ear mushroom","tai nấm mèo khô":"dried wood ear mushroom","nấm tổng hợp":"mixed mushroom","các loại nấm rừng":"mixed mushroom","nấm hỗn hợp":"mixed mushroom","rau chân vịt non":"baby spinach","cải bó xôi non":"baby spinach","rau bina baby":"baby spinach","rau chân vịt đông lạnh":"frozen spinach","cải bó xôi đông lạnh":"frozen spinach","cây bông cải xanh":"broccoli","bông cải xanh thân dài":"broccolini","súp lơ xanh baby":"broccolini","cải rổ bông":"broccolini","cải ngồng ý broccoli rabe":"broccoli rabe","cải ngồng đắng":"broccoli rabe","bông cải trắng":"cauliflower","súp lơ trắng":"cauliflower","cây súp lơ trắng":"cauliflower","bắp cải trắng":"cabbage","bắp cải tím":"red cabbage","cải bắp tím":"red cabbage","bắp cải đỏ":"red cabbage","cải thảo":"napa cabbage","bắp cải thảo":"napa cabbage","rau cải thảo":"napa cabbage","bắp cải xoăn savoy":"savoy cabbage","bắp cải nhăn":"savoy cabbage","cải chíp":"bok choy","cải thìa non":"baby bok choy","cải chíp non":"baby bok choy","cải thìa baby":"baby bok choy","cải ngọt":"choy sum","rau cải ngọt":"choy sum","cải xoăn kale":"kale","rau cải xoăn":"kale","cải kale":"kale","cải cầu vồng":"swiss chard","rau cải cầu vồng":"swiss chard","cải thụy sĩ":"swiss chard","cải rổ":"collard greens","rau cải rổ":"collard greens","lá cải rổ":"collard greens","cải xoong":"watercress","rau cải xoong":"watercress","rau cải tên lửa arugula":"arugula","xà lách rocket":"arugula","rau rocket":"arugula","xà lách romaine":"romaine lettuce","xà lách lô lô":"romaine lettuce","rau xà lách":"romaine lettuce","xà lách":"romaine lettuce","xà lách giòn iceberg":"iceberg lettuce","xà lách búp mỹ":"iceberg lettuce","xà lách cuộn":"iceberg lettuce","xà lách mỡ":"butter lettuce","xà lách bơ":"butter lettuce","xà lách bibb":"butter lettuce","xà lách tím radicchio":"radicchio","rau diếp tím ý":"radicchio","rau diếp xoăn endive":"belgian endive","xà lách endive":"belgian endive","cải cúc đắng âu":"belgian endive","trái dưa leo":"cucumber","quả dưa chuột":"cucumber","dưa leo không hạt":"seedless cucumber","dưa chuột không hạt":"seedless cucumber","dưa leo baby ba tư":"persian cucumber","dưa chuột bao tử":"persian cucumber","dưa leo mini":"persian cucumber","bí ngòi xanh":"zucchini","bí ngòi":"zucchini","quả bí ngòi":"zucchini","bí ngòi vàng":"yellow squash","bí mùa hè vàng":"yellow squash","bí đỏ hồ lô":"butternut squash","bí butternut":"butternut squash","bí hồ lô":"butternut squash","bí đỏ acorn":"acorn squash","bí sồi":"acorn squash","bí đỏ":"pumpkin","bí ngô":"pumpkin","quả bí đỏ":"pumpkin","trái bí đỏ":"pumpkin","bí đỏ nghiền đóng hộp":"canned pure pumpkin","bí ngô nghiền":"canned pure pumpkin","sốt bí đỏ nguyên chất":"canned pure pumpkin","cà tím":"eggplant","quả cà tím":"eggplant","trái cà tím":"eggplant","quả ớt chuông":"bell_pepper","ớt ngọt":"bell_pepper","quả ớt chuông đỏ":"red bell pepper","ớt chuông xanh":"green bell pepper","quả ớt chuông xanh":"green bell pepper","ớt chuông vàng":"yellow bell pepper","quả ớt chuông vàng":"yellow bell pepper","ớt chuông cam":"orange bell pepper","quả ớt chuông cam":"orange bell pepper","ớt chuông đỏ nướng":"roasted red bell_pepper","ớt chuông đỏ nướng đóng lọ":"roasted red bell_pepper","quả đậu que":"green bean","đậu cô ve xanh":"green bean","đậu hà lan":"pea","hạt đậu hà lan":"pea","đậu hà lan tươi":"pea","đậu hà lan đông lạnh":"frozen pea","hạt đậu hà lan đông lạnh":"frozen pea","đậu hà lan giòn ngọt":"sugar snap pea","đậu hà lan ăn cả vỏ":"sugar snap pea","đậu snap pea":"sugar snap pea","đậu tuyết":"snow pea","đậu hà lan dẹt":"snow pea","đậu ván tuyết":"snow pea","giá đỗ":"bean sprouts","giá":"bean sprouts","giá đậu xanh":"bean sprouts","đậu bắp":"okra","quả đậu bắp":"okra","trái đậu bắp":"okra","ngô ngọt":"corn","bắp mỹ":"corn","hạt ngô ngọt":"corn kernels","hạt bắp":"corn kernels","ngô tách hạt":"corn kernels","ngô ngọt đông lạnh":"frozen corn","hạt bắp đông lạnh":"frozen corn","măng tây":"asparagus","măng tây xanh":"asparagus","cọng măng tây":"asparagus","cần tây":"celery","rau cần tây":"celery","cọng cần tây":"celery stalk","nhánh cần tây":"celery stalk","thân cần tây":"celery stalk","củ cần tây":"celery root","cần tây củ":"celery root","củ celeriac":"celery root","củ tiểu hồi":"fennel bulb","củ thì là tây":"fennel bulb","bẹ tiểu hồi":"fennel bulb","củ cải đỏ tròn":"radish","củ cải đường nhỏ":"radish","củ cải đỏ":"radish","củ cải trắng":"daikon","củ cải":"daikon","củ cải trắng nhật":"daikon","củ cải turnip":"turnip","củ cải trắng tròn âu":"turnip","củ dền":"beet","củ dền đỏ":"beet","củ cải dền":"beet","củ cải vàng parsnip":"parsnips","cà rốt trắng":"parsnips","củ parsnip":"parsnips","bắp cải tí hon brussels":"brussels sprouts","bắp cải mini":"brussels sprouts","cải bi brussels":"brussels sprouts","hoa atisô":"artichokes","atisô":"artichokes","bông atisô":"artichokes","tỏi băm nhỏ":"garlic","tỏi tươi":"garlic","củ hành khô":"shallot","hành ta":"shallot","cọng hành lá":"green_onion","hành hoa":"green_onion","hẹ tây":"chives","lá hẹ":"chives","hẹ":"chives","cọng hẹ":"chives","nhánh gừng nhỏ":"ginger","gừng tươi":"ginger","gừng băm":"ginger","gừng nhỏ":"ginger","củ sả":"lemongrass","sả băm":"lemongrass","sả cây":"lemongrass","nghệ tươi":"turmeric","củ nghệ":"turmeric","nghệ":"turmeric","rau ngò":"cilantro","mùi ta":"cilantro","mùi tây":"parsley","rau mùi tây":"parsley","ngò tây":"parsley","mùi tây lá phẳng":"flat-leaf parsley","ngò tây lá phẳng":"flat-leaf parsley","mùi tây ý":"flat-leaf parsley","húng quế / húng tây":"basil","rau húng quế":"basil","lá húng tây":"basil","húng tây":"basil","húng quế":"basil","lá húng tây đóng gói":"packaged basil leaf","húng tây tươi đóng gói":"packaged basil leaf","bạc hà / húng lủi":"mint","lá bạc hà":"mint","rau húng lủi":"mint","húng lủi":"mint","bạc hà tươi":"mint","lá bạc hà và một nhánh để trang trí":"mint leaf plus sprig","thì là":"dill","rau thì là":"dill","lá thì là":"dill","hương thảo":"rosemary","lá hương thảo":"rosemary","nhánh hương thảo":"rosemary","cỏ xạ hương thyme":"thyme","lá xạ hương":"thyme","xạ hương tươi":"thyme","kinh giới cay oregano":"oregano","lá oregano tươi":"oregano","lá xô thơm sage":"sage","cây xô thơm":"sage","xô thơm":"sage","ngải giấm tarragon":"tarragon","lá ngải giấm":"tarragon","rau ngải giấm":"tarragon","kinh giới ngọt marjoram":"marjoram","lá kinh giới ngọt":"marjoram","các loại rau thơm":"assorted herbs","rau thơm hỗn hợp":"assorted herbs","rau thơm mềm như thì là hoặc mùi tây":"tender herbs such as dill or parsley","lá chanh thái":"kaffir lime leaf","lá chanh":"kaffir lime leaf","lá chanh chúc":"kaffir lime leaf","lá cà ri tươi":"curry leaf","lá cà ri":"curry leaf","quả ớt hiểm":"thai chile","ớt chỉ thiên":"thai chile","ớt cay":"thai chile","ớt tươi":"thai chile","ớt đỏ cay":"thai chile","ớt jalapeño":"jalapeño","ớt xanh mexico jalapeño":"jalapeño","ớt serrano":"serrano chile","ớt cay serrano":"serrano chile","ớt poblano":"poblano chile","ớt xanh poblano":"poblano chile","ớt sừng đỏ":"red chile","ớt đỏ tươi":"red chile","ớt sừng":"red chile","củ cải ngựa horseradish":"horseradish","cải ngựa mài":"horseradish","mù tạt củ cải ngựa":"horseradish","quả chanh vàng":"lemon","trái chanh vàng":"lemon","nước cốt chanh vàng":"lemon juice","nước chanh vàng":"lemon juice","vỏ chanh vàng bào":"lemon zest","vỏ chanh vàng":"lemon zest","vỏ chanh bào":"lemon zest","chanh vàng muối":"preserved lemon","chanh muối kiểu ma-rốc":"preserved lemon","chanh muối kiểu ma rốc":"preserved lemon","trái chanh":"lime","chanh ta":"lime","chanh không hạt":"lime","nước cốt chanh xanh":"lime juice","nước cốt chanh":"lime juice","nước chanh tươi":"lime juice","vỏ chanh xanh bào":"lime zest","vỏ chanh xanh":"lime zest","múi chanh xanh":"lime wedge","lát chanh xanh":"lime wedge","miếng chanh":"lime wedge","cam":"orange","quả cam":"orange","trái cam":"orange","cam tươi":"orange","nước cam":"orange juice","nước cam ép":"orange juice","nước cốt cam":"orange juice","vỏ cam bào":"orange zest","vỏ cam":"orange zest","bưởi chùm grapefruit":"grapefruit","bưởi đào":"grapefruit","bưởi đỏ":"grapefruit","quả bưởi":"grapefruit","nước ép bưởi":"grapefruit juice","nước bưởi ép":"grapefruit juice","quả táo":"apple","trái táo":"apple","táo tươi":"apple","táo xanh granny smith":"granny smith apple","táo xanh":"granny smith apple","quả táo xanh":"granny smith apple","nước ép táo":"apple juice","nước táo":"apple juice","sốt táo nghiền":"applesauce","táo nghiền":"applesauce","quả chuối":"banana","trái chuối":"banana","chuối chín":"banana","quả dâu tây":"strawberry","trái dâu tây":"strawberry","quả việt quất":"blueberry","phúc bồn tử đỏ":"raspberry","quả mâm xôi đỏ":"raspberry","phúc bồn tử":"raspberry","mâm xôi đen":"blackberry","quả mâm xôi đen":"blackberry","dâu tằm đen":"blackberry","nam việt quất tươi":"cranberry","quả nam việt quất":"cranberry","nam việt quất khô":"dried cranberry","mứt nam việt quất sấy":"dried cranberry","anh đào tươi (cherry)":"cherry","quả cherry":"cherry","trái anh đào":"cherry","anh đào khô":"dried cherry","cherry sấy khô":"dried cherry","đào":"peach","quả đào":"peach","trái đào":"peach","đào chín":"peach","đào trơn xuân đào":"nectarines","quả xuân đào":"nectarines","mận":"plum","quả mận":"plum","trái mận":"plum","mơ tươi":"apricot","quả mơ":"apricot","mơ sấy khô":"dried apricot","quả mơ khô":"dried apricot","xoài":"mango","quả xoài":"mango","trái xoài":"mango","xoài chín":"mango","dứa":"pineapple","thơm":"pineapple","khóm":"pineapple","quả dứa":"pineapple","trái thơm":"pineapple","thơm (dứa)":"pineapple","quả thơm (dứa)":"pineapple","nước ép dứa":"pineapple juice","nước thơm ép":"pineapple juice","quả bơ":"avocado","trái bơ":"avocado","bơ sáp":"avocado","quả bơ chín":"avocado","dừa tươi":"coconut","trái dừa tươi":"coconut","cùi dừa tươi":"coconut","nước dừa tươi":"coconut water","nước dừa":"coconut water","dừa nạo không đường":"unsweetened coconut","cơm dừa sấy không đường":"unsweetened coconut","dừa nạo sấy có đường":"sweetened flaked coconut","dừa sấy ngọt":"sweetened flaked coconut","lê":"pear","quả lê":"pear","trái lê":"pear","nho đỏ không hạt":"seedless red grape","nho":"seedless red grape","quả nho":"seedless red grape","nho tươi":"seedless red grape","nho khô":"raisin","nho sấy khô":"raisin","nho khô vàng":"golden raisin","nho vàng sấy":"golden raisin","nho chuỗi ngọc khô":"dried currant","nho đen nhỏ sấy khô":"dried currant","chà là":"date","quả chà là":"date","chà là sấy":"date","sung mỹ tươi":"fig","quả sung ngọt":"fig","trái vả":"fig","sung mỹ sấy khô":"dried fig","quả sung khô":"dried fig","hạt lựu":"pomegranate seed","lựu":"pomegranate seed","quả lựu":"pomegranate seed","nước ép lựu":"pomegranate juice","nước lựu":"pomegranate juice","đại hoàng rhubarb":"rhubarb","dọc đại hoàng":"rhubarb","quả huckleberry":"huckleberries","sữa tươi không đường":"milk","sữa nguyên kem":"whole milk","sữa tươi nguyên kem":"whole milk","sữa đặc có đường":"sweetened condensed milk","sữa đặc":"sweetened condensed milk","sữa ông thọ":"sweetened condensed milk","sữa bơ buttermilk":"buttermilk","sữa lên men buttermilk":"buttermilk","kem tươi whipping":"heavy cream","kem sữa béo":"heavy cream","kem tươi đánh bông":"whipped cream","kem bông":"whipped cream","kem sữa pha half-and-half":"half-and-half","kem sữa pha half and half":"half-and-half","sữa kem half and half":"half-and-half","kem chua":"sour cream","sốt kem chua":"sour cream","kem chua pháp crème fraîche":"crème fraîche","kem creme fraiche":"crème fraîche","sữa chua không đường":"plain yogurt","sữa chua":"plain yogurt","sữa chua trắng":"plain yogurt","sữa chua hy lạp":"plain greek yogurt","sữa chua hy lạp nguyên kem":"plain greek yogurt","bơ không muối":"unsalted butter","bơ nhạt":"unsalted butter","bơ mặn":"salted butter","bơ có muối":"salted butter","phô mát":"cheese","pho mát":"cheese","phô mai kem (cream cheese)":"cream cheese","kem phô mai":"cream cheese","phô mai cream cheese":"cream cheese","phô mai parmesan":"parmesan cheese","phô mai bột parmesan":"parmesan cheese","parmesan bào":"parmesan cheese","phô mai mozzarella":"mozzarella cheese","phô mai kéo sợi":"mozzarella cheese","mozzarella bào":"mozzarella cheese","phô mai cheddar":"cheddar cheese","phô mai lát cheddar":"cheddar cheese","phô mai vàng cheddar":"cheddar cheese","phô mai sữa dê":"goat cheese","phô mai feta":"feta cheese","phô mai mặn hy lạp feta":"feta cheese","phô mai ricotta":"ricotta cheese","phô mai tươi ricotta":"ricotta cheese","phô mai mascarpone":"mascarpone cheese","kem phô mai ý mascarpone":"mascarpone cheese","phô mai gruyère":"gruyère cheese","phô mai thụy sĩ gruyere":"gruyère cheese","phô mai cừu pecorino":"pecorino romano cheese","phô mai pecorino":"pecorino romano cheese","phô mai fontina":"fontina cheese","phô mai ý fontina":"fontina cheese","phô mai monterey jack":"monterey jack cheese","phô mai tươi burrata":"burrata cheese","phô mai burrata":"burrata cheese","kem vani":"vanilla ice cream","kem lạnh vị vani":"vanilla ice cream","cơm nóng":"cooked rice","gạo tẻ hạt dài":"long-grain white rice","gạo trắng":"long-grain white rice","gạo tẻ":"long-grain white rice","gạo nấu cơm":"long-grain white rice","gạo thơm jasmine":"jasmine rice","gạo lài":"jasmine rice","gạo thơm thái":"jasmine rice","gạo basmati ấn độ":"basmati rice","gạo hạt dài basmati":"basmati rice","gạo ý arborio nấu risotto":"arborio rice","gạo risotto":"arborio rice","gạo hạt tròn arborio":"arborio rice","gạo nhật hạt tròn":"short-grain rice","gạo sushi":"short-grain rice","gạo hạt ngắn":"short-grain rice","gạo đen hoang dã":"wild rice","gạo lứt đen":"wild rice","vắt mì trứng":"egg noodle","mì sợi trứng":"egg noodle","mì trứng khô bản rộng":"dried wide egg noodle","mì trứng sợi dẹt":"dried wide egg noodle","mì ý spaghetti":"spaghetti","mì spaghetti":"spaghetti","mì ý sợi tròn":"spaghetti","mì ý sợi dẹt linguine":"linguine","mì linguine":"linguine","mì ý bản rộng fettuccine":"fettuccine","mì fettuccine":"fettuccine","nui ống penne":"penne","mì ống penne":"penne","nui ống":"penne","nui ống lớn rigatoni":"rigatoni","mì ống rigatoni":"rigatoni","mì hạt gạo orzo":"orzo","nui hạt gạo":"orzo","mì ống / nui ý":"pasta","nui":"pasta","mì ý":"pasta","mì kiều mạch soba":"soba noodle","mì soba nhật":"soba noodle","ổ bánh mì":"bread","bánh mì lát":"bread","bánh mì pháp baguette":"baguette","bánh mì ổ dài":"baguette","bánh mì que pháp":"baguette","bánh mì vỏ giòn kiểu quê":"country-style bread","bánh mì sourdough":"country-style bread","bánh mì vỏ cứng":"country-style bread","ổ bánh mì pháp để khô":"loaf of stale french bread","vỏ bánh mì burger":"hamburger buns","bánh mì tròn kẹp thịt":"hamburger buns","vụn bánh mì":"bread crumbs","bột chiên xù mịn":"bread crumbs","bột chiên xù nhật (panko)":"panko","bột chiên xù":"panko","vụn bánh mì panko":"panko","bánh tráng ngô tortilla":"corn tortilla","vỏ bánh taco ngô":"corn tortilla","bánh tortilla bắp":"corn tortilla","vỏ bánh cuộn bột mì tortilla":"flour tortilla","bánh tortilla bột mì":"flour tortilla","vỏ bánh burrito":"flour tortilla","bánh ngô chiên giòn nachos":"tortilla chips","bánh snack ngô":"tortilla chips","bánh nachos":"tortilla chips","khoai tây lát chiên giòn":"potato chips","bimbim khoai tây":"potato chips","vỏ bánh ngàn lớp đông lạnh":"frozen puff pastry","bột ngàn lớp puff pastry":"frozen puff pastry","bột mỳ":"flour","bột mì số 11":"all-purpose flour","bột mì thường":"all-purpose flour","bột mì đa dụng không tẩy trắng":"unbleached all-purpose flour","bột mì tự nở":"self-rising flour","bột mì pha sẵn bột nở":"self-rising flour","bột mì làm bánh mì (số 13)":"bread flour","bột bánh mì":"bread flour","bột mì làm bánh bông lan (số 8)":"cake flour","bột làm bánh ngọt":"cake flour","bột cake flour":"cake flour","bột mì nguyên cám":"whole wheat flour","bột mì đen nguyên cám":"whole wheat flour","bột gạo":"rice flour","bột gạo tẻ":"rice flour","bột đậu gà":"chickpea flour","bột gram ấn độ":"chickpea flour","bột bắp (tinh bột ngô)":"cornstarch","bột bắp":"cornstarch","tinh bột ngô":"cornstarch","bột ngô":"cornstarch","tinh bột khoai tây":"potato starch","bột khoai tây":"potato starch","bột ngô hạt tấm":"cornmeal","bột bắp hạt thô":"cornmeal","bột ngô nấu polenta":"polenta","bột bắp ý polenta":"polenta","yến mạch cán dẹt":"old-fashioned oats","yến mạch":"old-fashioned oats","hạt yến mạch":"old-fashioned oats","hạt diêm mạch (quinoa)":"quinoa","diêm mạch":"quinoa","hạt quinoa":"quinoa","hạt bột mì couscous":"couscous","hạt couscous":"couscous","lúa mì nứt bulgur":"bulgur","hạt lúa mì bulgur":"bulgur","hạt lúa mì cổ đại farro":"farro","lúa mạch farro":"farro","hạt ý dĩ / lúa mạch vo tròn":"pearl barley","hạt bo bo":"pearl barley","lúa mạch":"pearl barley","vụn bánh quy graham":"graham cracker crumbs","bánh quy nghiền làm đế bánh":"graham cracker crumbs","bột bánh quy không men matzo":"matzo meal","bột bánh matzo":"matzo meal","đậu đen":"black bean","hạt đậu đen":"black bean","đỗ đen":"black bean","đậu trắng":"white bean","hạt đậu trắng":"white bean","đậu trắng ý cannellini":"cannellini bean","đậu cannellini":"cannellini bean","đậu cút pinto":"pinto bean","đậu đốm pinto":"pinto bean","đậu gà":"chickpea","hạt đậu gà":"chickpea","đậu lăng đỏ":"red lentil","hạt đậu lăng":"red lentil","đậu lăng":"red lentil","đậu trắng mắt đen":"black-eyed pea","đậu mắt đen":"black-eyed pea","đậu nành nhật edamame":"frozen shelled edamame","đậu tương lông":"frozen shelled edamame","đậu edamame":"frozen shelled edamame","hạnh nhân":"almond","hạt hạnh nhân":"almond","hạt óc chó":"walnut","quả óc chó":"walnut","nhân hạt óc chó":"walnut","hạt hồ đào":"pecan","hạt hồ đào pecan":"pecan","quả hồ đào":"pecan","hạt dẻ cười":"pistachio","quả hồ trăn":"pistachio","nhân hạt dẻ cười":"pistachio","hạt phỉ hazelnut":"hazelnut","hạt phỉ":"hazelnut","hạt thông":"pine nuts","nhân hạt thông":"pine nuts","đậu phộng (lạc)":"peanut","đậu phộng":"peanut","lạc":"peanut","hạt lạc":"peanut","đậu phộng rang":"peanut","hạt điều":"cashew","hạt điều rang":"cashew","nhân hạt điều":"cashew","hạt mè (vừng)":"sesame seed","mè trắng":"sesame seed","vừng trắng":"sesame seed","hạt vừng":"sesame seed","hạt mè":"sesame seed","hạt mè đen (vừng đen)":"black sesame seed","mè đen":"black sesame seed","vừng đen":"black sesame seed","hạt bí xanh":"pumpkin seed","hạt bí":"pumpkin seed","nhân hạt bí ngô":"pumpkin seed","hạt chia":"chia seed","hạt chia đen":"chia seed","hạt anh túc làm bánh":"poppy seed","hạt poppy":"poppy seed","nước mắm ngon":"fish sauce","mắm":"fish sauce","nước tương (xì dầu)":"soy sauce","nước tương ít muối":"low-sodium soy sauce","xì dầu giảm mặn":"low-sodium soy sauce","nước tương đen đậm đặc":"dark soy sauce","hắc xì dầu":"dark soy sauce","xì dầu đen":"dark soy sauce","sốt dầu hào":"oyster sauce","tương đen hoisin":"hoisin sauce","sốt hoisin":"hoisin sauce","tương ngọt ăn phở":"hoisin sauce","tương ớt sriracha":"sriracha","tương ớt":"sriracha","sốt ớt cay sriracha":"sriracha","tương ớt tỏi":"chili-garlic sauce","sốt ớt tỏi":"chili-garlic sauce","tương ớt hàn quốc gochujang":"gochujang","sốt ớt hàn quốc":"gochujang","tương gochujang":"gochujang","kim chi cải thảo":"kimchi","kim chi":"kimchi","kimchi hàn quốc":"kimchi","tương miso trắng":"white miso","tương đậu nành nhật miso":"white miso","tương miso":"white miso","rượu gia vị nhật mirin":"mirin","rượu ngọt mirin":"mirin","rượu sake nấu ăn":"sake","rượu gạo nhật sake":"sake","sốt bơ mè tahini":"tahini","bơ vừng tahini":"tahini","sốt mè nghiền":"tahini","bơ đậu phộng":"peanut butter","bơ lạc":"peanut butter","sốt mayonnaise":"mayonnaise","sốt mayo":"mayonnaise","xốt mayonnaise":"mayonnaise","tương cà (ketchup)":"ketchup","tương cà":"ketchup","sốt cà chua ketchup":"ketchup","cà chua cô đặc (tomato paste)":"tomato paste","sốt cà chua đặc":"tomato paste","cà chua nhuyễn cô đặc":"tomato paste","sốt cà chua":"tomato sauce","nước sốt cà chua":"tomato sauce","mù tạt vàng dijon":"dijon mustard","mù tạt pháp dijon":"dijon mustard","sốt mù tạt":"dijon mustard","mù tạt nguyên hạt":"whole-grain mustard","mù tạt hạt":"whole-grain mustard","sốt worcestershire":"worcestershire sauce","nước sốt anh worcestershire":"worcestershire sauce","sốt ớt cay":"hot sauce","tương ớt cay tabasco":"hot sauce","tương ớt bắc phi harissa":"harissa paste","sốt ớt harissa":"harissa paste","nụ bạch hoa ngâm (capers)":"caper","nụ bạch hoa":"caper","hạt caper":"caper","dưa chuột bao tử muối chua":"cornichons","dưa leo muối chua":"cornichons","dưa chuột muối":"cornichons","me chua":"tamarind","vắt me chua":"tamarind","cốt me":"tamarind","nước cốt me":"tamarind","mật lựu cô đặc":"pomegranate molasses","sốt mật lựu":"pomegranate molasses","dầu chiên":"vegetable oil","dầu olive":"olive oil","dầu ô liu nguyên chất":"extra-virgin olive oil","dầu olive nguyên chất ép lạnh":"extra-virgin olive oil","dầu cải":"canola oil","dầu hạt cải":"canola oil","dầu đậu phộng":"peanut oil","dầu lạc":"peanut oil","dầu ngô":"corn oil","dầu ngô bắp":"corn oil","dầu hạt nho":"grapeseed oil","dầu dừa":"coconut oil","dầu dừa nguyên chất":"coconut oil","dầu mè (dầu vừng)":"sesame oil","dầu mè":"sesame oil","dầu vừng":"sesame oil","dầu mè thơm":"sesame oil","giấm trắng":"distilled white vinegar","giấm ăn":"distilled white vinegar","giấm gạo trắng":"distilled white vinegar","giấm gạo":"rice vinegar","giấm gạo nhật":"rice vinegar","giấm táo":"apple cider vinegar","dấm táo":"apple cider vinegar","giấm rượu vang đỏ":"red wine vinegar","giấm vang đỏ":"red wine vinegar","giấm rượu vang trắng":"white wine vinegar","giấm vang trắng":"white wine vinegar","giấm đen balsamic":"balsamic vinegar","giấm balsamic ý":"balsamic vinegar","giấm rượu sherry":"sherry vinegar","giấm sherry":"sherry vinegar","nước cốt dừa":"coconut milk","sữa dừa":"coconut milk","nước cốt dừa lon":"coconut milk","rượu vang trắng":"dry white wine","vang trắng nấu ăn":"dry white wine","rượu vang đỏ":"dry red wine","vang đỏ nấu ăn":"dry red wine","rượu sherry nấu ăn":"dry sherry","rượu vang sherry":"dry sherry","rượu vermouth khô":"dry vermouth","rượu mùi vermouth":"dry vermouth","rượu vodka":"vodka","rượu rum trắng":"white rum","rượu rum":"white rum","rượu whisky bourbon":"bourbon","rượu bourbon":"bourbon","rượu mạnh brandy / cognac":"brandy","rượu brandy":"brandy","rượu cognac":"brandy","rượu gin":"gin","rượu đắng campari":"campari","rượu mùi st-germain":"st-germain","rượu mùi st germain":"st-germain","muối ăn":"salt","muối tinh":"salt","muối kosher":"kosher salt","muối hạt kosher":"kosher salt","muối biển":"sea salt","muối hạt biển":"sea salt","muối biển dạng vảy, như maldon":"flaky sea salt such as maldon","muối biển dạng vảy, ưu tiên fleur de sel":"flaky sea salt, preferably fleur de sel","hồ tiêu":"pepper","tiêu đen":"black pepper","hạt tiêu đen":"black pepper","tiêu đen xay":"ground black pepper","hạt tiêu xay":"ground black pepper","tiêu đen vừa xay":"ground black pepper","tiêu trắng xay":"ground white pepper","tiêu sọ":"ground white pepper","tiêu trắng":"ground white pepper","hạt tiêu sọ":"ground white pepper","hoa tiêu tứ xuyên":"sichuan peppercorns","tiêu tứ xuyên":"sichuan peppercorns","mắc khén / hoa tiêu":"sichuan peppercorns","ớt khô dạng mảnh (chili flakes)":"red pepper flakes","ớt bột mảnh":"red pepper flakes","ớt mảnh khô":"red pepper flakes","ớt bột":"chili powder","bột ớt":"chili powder","ớt bột mịn":"chili powder","ớt bột cay cayenne":"cayenne pepper","bột ớt cayenne":"cayenne pepper","tiêu cayenne":"cayenne pepper","bột ớt ngọt paprika":"paprika","ớt bột paprika":"paprika","bột ớt paprika hun khói":"smoked paprika","paprika xông khói":"smoked paprika","bột thì là ai cập (cumin)":"ground cumin","bột cumin":"ground cumin","thì là ai cập xay":"ground cumin","hạt thì là ai cập (cumin)":"cumin seed","hạt cumin":"cumin seed","bột hạt mùi (ngò)":"ground coriander","bột hạt ngò":"ground coriander","hạt mùi xay":"ground coriander","hạt mùi khô (hạt ngò)":"coriander seed","hạt ngò":"coriander seed","hạt mùi":"coriander seed","bột nghệ":"ground turmeric","tinh bột nghệ":"ground turmeric","bột cà ri":"curry powder","gia vị cà ri":"curry powder","bột gia vị ấn độ garam masala":"garam masala","gia vị garam masala":"garam masala","bột ngũ vị hương":"chinese five-spice powder","ngũ vị hương":"chinese five-spice powder","gói ngũ vị hương":"chinese five-spice powder","bột quế":"ground cinnamon","quế xay":"ground cinnamon","quế":"cinnamon","thanh quế":"cinnamon","quế cây":"cinnamon","vỏ quế":"cinnamon","hoa hồi (đại hồi)":"whole star anise","hoa hồi":"whole star anise","đại hồi":"whole star anise","cánh hồi":"whole star anise","bột thảo quả / bạch đậu khấu":"ground cardamom","bột bạch đậu khấu":"ground cardamom","bột nhục đậu khấu":"ground nutmeg","nhục đậu khấu":"ground nutmeg","hạt nhục đậu khấu":"ground nutmeg","bột đinh hương":"ground clove","đinh hương":"ground clove","nụ đinh hương":"ground clove","bột tiêu jamaica":"ground allspice","tiêu jamaica":"ground allspice","bột gừng khô":"ground ginger","bột gừng":"ground ginger","bột tỏi":"garlic powder","tỏi bột":"garlic powder","bột hành tây":"onion powder","bột hành":"onion powder","bột mù tạt khô":"dry mustard","mù tạt bột":"dry mustard","hạt mù tạt":"mustard seed","hạt cải mù tạt":"mustard seed","hạt tiểu hồi":"fennel seed","hạt thì là tây":"fennel seed","hạt caraway":"caraway seed","hạt thì là ba tư":"caraway seed","hạt cần tây":"celery seed","muối cần tây":"celery seed","lá nguyệt quế":"bay leaf","lá thơm nguyệt quế":"bay leaf","lá bay leaf":"bay leaf","lá oregano khô":"dried oregano","kinh giới cay khô":"dried oregano","lá xạ hương khô (thyme khô)":"dried thyme","cỏ xạ hương khô":"dried thyme","lá hương thảo khô":"dried rosemary","hương thảo khô":"dried rosemary","lá húng tây khô":"dried basil","basil khô":"dried basil","nhụy hoa nghệ tây (saffron)":"saffron threads","nhụy nghệ tây":"saffron threads","nghệ tây":"saffron threads","bột gia vị chua sumac":"sumac","gia vị sumac":"sumac","quả bách xù khô":"juniper berries","hạt bách xù":"juniper berries","bột gia vị bánh bí đỏ":"pumpkin pie spice","gia vị bánh bí ngô":"pumpkin pie spice","nước dùng gà":"chicken broth","nước hầm gà":"chicken broth","nước luộc gà":"chicken broth","nước dùng gà ít muối":"low-salt chicken broth","nước dùng gà giảm mặn":"low-salt chicken broth","nước dùng bò":"beef broth","nước hầm xương bò":"beef broth","nước dùng rau củ":"vegetable broth","nước hầm rau củ chay":"vegetable broth","nước luộc nghêu đóng chai":"clam juice","nước dùng nghêu / hải sản":"clam juice","tảo bẹ khô nhật (kombu)":"dried kombu","rong biển kombu nấu dashi":"dried kombu","tảo bẹ kombu":"dried kombu","nước":"water","nước lọc":"water","nước sạch":"water","đường trắng":"sugar","đường kính":"sugar","đường cát":"granulated sugar","đường cát trắng":"granulated sugar","đường nâu":"brown sugar","đường đỏ":"brown sugar","đường vàng":"brown sugar","đường nâu nhạt":"light brown sugar","đường nâu sáng màu":"light brown sugar","đường nâu sẫm":"dark brown sugar","đường đen hàn quốc":"dark brown sugar","đường bột":"powdered sugar","đường xay":"powdered sugar","đường icing":"powdered sugar","mật ong":"honey","mật ong rừng":"honey","mật ong nguyên chất":"honey","siro lá phong (maple syrup)":"pure maple syrup","siro cây phong":"pure maple syrup","siro phong":"pure maple syrup","mật cây thùa (agave)":"agave nectar","siro agave":"agave nectar","mật mía đen (molasses)":"molasses","mật mía":"molasses","mật đường":"molasses","siro ngô (corn syrup)":"light corn syrup","mạch nha ngô":"light corn syrup","siro bắp":"light corn syrup","bột nở":"baking powder","bột nở (baking powder)":"baking powder","bột nổi":"baking powder","muối nở":"baking soda","muối nở (baking soda)":"baking soda","bột baking soda":"baking soda","men nở khô (dry yeast)":"active dry yeast","men làm bánh mì":"active dry yeast","men nở":"active dry yeast","bột ổn định lòng trắng trứng (cream of tartar)":"cream of tartar","bột tartar":"cream of tartar","bột gelatin không mùi":"unflavored gelatin","lá gelatin":"unflavored gelatin","bột gelatin":"unflavored gelatin","vani":"vanilla","hương vani":"vanilla","chiết xuất vani":"vanilla extract","tinh chất vani":"vanilla extract","chiết xuất vani nguyên chất":"pure vanilla extract","quả vani nguyên trái":"vanilla bean","nhánh vani":"vanilla bean","sốt vani":"vanilla bean","chiết xuất hạnh nhân":"almond extract","tinh chất hạnh nhân":"almond extract","chiết xuất bạc hà":"peppermint extract","tinh chất bạc hà làm bánh":"peppermint extract","nước hoa hồng thực phẩm":"rose water","nước cất hoa hồng":"rose water","nước hoa cam":"rose water","bột ca cao không đường":"unsweetened cocoa powder","bột cacao":"unsweetened cocoa powder","bột ca cao nguyên chất":"unsweetened cocoa powder","sô-cô-la":"chocolate","sô cô la":"chocolate","socola":"chocolate","sô-cô-la đen":"dark chocolate","sô cô la đen":"dark chocolate","socola đen":"dark chocolate","sô-cô-la đắng (bittersweet)":"bittersweet chocolate","sô cô la đắng (bittersweet)":"bittersweet chocolate","socola đắng 70%":"bittersweet chocolate","sô-cô-la bán ngọt":"semisweet chocolate","sô cô la bán ngọt":"semisweet chocolate","sô-cô-la làm bánh":"semisweet chocolate","sô cô la làm bánh":"semisweet chocolate","sô-cô-la bán ngọt chất lượng tốt":"good-quality semisweet chocolate","sô cô la bán ngọt chất lượng tốt":"good-quality semisweet chocolate","sô-cô-la trắng":"white chocolate","sô cô la trắng":"white chocolate","socola trắng":"white chocolate","bột cà phê espresso hòa tan":"instant espresso powder","bột cà phê đen":"instant espresso powder","cà phê espresso pha sẵn":"brewed espresso","cà phê đen pha đậm":"brewed espresso","kem trứng làm bánh":"pastry cream","kem su kem":"pastry cream","mỡ thực vật làm bánh (shortening)":"vegetable shortening","bơ thực vật shortening":"vegetable shortening","mứt gừng kết tinh":"crystallized ginger","mứt gừng khô":"crystallized ginger","mứt vỏ cam":"candied orange peel","vỏ cam sên đường":"candied orange peel","mứt cam marmalade":"orange marmalade","mứt vỏ cam dẻo":"orange marmalade","mứt mơ":"apricot preserves","mứt quả mơ":"apricot preserves","mứt phúc bồn tử":"raspberry jam","mứt dâu mâm xôi":"raspberry jam","thit ga song":"chicken","thit ga chat mieng":"chicken","ga chat mieng":"chicken","ga ta":"chicken","uc ga phi le":"chicken breast","phi le uc ga":"chicken breast","uc ga rut xuong bo da":"boneless skinless chicken breast","uc ga khong xuong khong da":"boneless skinless chicken breast","uc ga phi le khong da":"boneless skinless chicken breast","dui ga rut xuong bo da":"skinless boneless chicken thigh","thit dui ga rut xuong":"skinless boneless chicken thigh","dui ga phi le":"skinless boneless chicken thigh","dui ga":"chicken thigh","thit dui ga":"chicken thigh","ma dui ga":"chicken thigh","dui ga nguyen xuong co da":"bone-in skin-on chicken thigh","dui ga co xuong co da":"bone-in skin-on chicken thigh","canh ga":"chicken wing","canh ga tuoi":"chicken wing","dui toi ga":"chicken drumstick","toi ga":"chicken drumstick","dui ga toi":"chicken drumstick","dui ga nguyen chiec":"chicken legs","chan dui ga":"chicken legs","goc tu dui ga":"chicken legs","than noi ga":"chicken tenders","phi le ga non":"chicken tenders","than ga":"chicken tenders","gan ga":"chicken livers","gan ga tuoi":"chicken livers","ga nguyen con":"whole chicken","ca con ga":"whole chicken","ga nguyen chiec":"whole chicken","thit ga chin":"cooked chicken","thit ga luoc":"cooked chicken","ga xe":"cooked chicken","ga quay chin":"cooked chicken","thit ga xay":"ground chicken","ga xay":"ground chicken","thit ga bam":"ground chicken","ga bam":"ground chicken","thit nac vai bo xay":"ground beef chuck","nac vai bo xay":"ground beef chuck","bo chuck xay":"ground beef chuck","thit nac vai bo":"beef chuck","nac vai bo":"beef chuck","bap bo nac vai":"beef chuck","thit bo ham":"beef chuck","thit nac vai bo rut xuong":"boneless beef chuck","nac vai bo khong xuong":"boneless beef chuck","thit than ngoai bo xay":"ground sirloin","than bo xay":"ground sirloin","bo sirloin xay":"ground sirloin","than noi bo":"beef tenderloin","than bo":"beef tenderloin","phi le bo":"beef tenderloin","thit than bo":"beef tenderloin","than bung bo":"flank steak","thit bo flank":"flank steak","thit de suon bung bo":"flank steak","thit diem than bo":"skirt steak","diem than bo":"skirt steak","bo skirt steak":"skirt steak","than ngoai bo":"sirloin steak","bo bit tet sirloin":"sirloin steak","thit than lung bo":"sirloin steak","than lung bo ribeye":"rib-eye steak","bo ribeye":"rib-eye steak","thit bo mat suon":"rib-eye steak","than ngoai bo new york":"new york strip steak","bo strip steak":"new york strip steak","than bo new york":"new york strip steak","uc bo":"beef brisket","gau bo":"beef brisket","thit uc bo":"beef brisket","nam bo":"beef brisket","suon non bo":"beef short ribs","suon bo":"beef short ribs","suon bo co xuong":"beef short ribs","suon bo rut xuong":"boneless beef short ribs","suon non bo khong xuong":"boneless beef short ribs","thit bo muoi":"corned beef","bo muoi corned beef":"corned beef","lon xay":"ground pork","lon bam":"ground pork","thit bam":"ground pork","thit xay":"ground pork","thit nac vai heo xay":"ground pork shoulder","nac vai xay":"ground pork shoulder","thit nac vai xay":"ground pork shoulder","nac vai lon xay":"ground pork shoulder","nac dam xay":"ground pork shoulder","thit nac vai lon xay":"ground pork shoulder","thit ba roi heo":"pork belly","thit ba chi lon":"pork belly","ba chi heo":"pork belly","suon heo non":"pork ribs","than noi heo":"pork tenderloin","than heo":"pork tenderloin","than lon":"pork tenderloin","thit than heo":"pork tenderloin","than lung heo rut xuong":"boneless pork loin","than lung heo":"boneless pork loin","thit cot let khong xuong":"boneless pork loin","thit nac vai heo":"pork shoulder","nac vai heo":"pork shoulder","nac dam heo":"pork shoulder","nac vai heo rut xuong":"boneless pork shoulder","vai heo khong xuong":"boneless pork shoulder","suon cot let heo":"bone-in pork chops","cot let heo":"bone-in pork chops","thit cot let":"bone-in pork chops","suon cot let":"bone-in pork chops","thit xong khoi":"bacon","ba roi xong khoi":"bacon","thit ba chi xong khoi":"bacon","thit xong khoi cat day":"thick-cut bacon","ba roi xong khoi lat day":"thick-cut bacon","thit xong khoi nguyen tang":"slab bacon","ba roi xong khoi nguyen khoi":"slab bacon","thit ba chi muoi y pancetta":"pancetta","thit muoi pancetta":"pancetta","ba roi muoi y":"pancetta","dui heo muoi y prosciutto":"prosciutto","thit nguoi prosciutto":"prosciutto","giam bong y":"prosciutto","thit nguoi":"ham","thit giam bong":"ham","cha lua au":"ham","giam bong chin":"cooked ham","thit nguoi chin":"cooked ham","giam bong thai lat":"cooked ham","giam bong muoi kieu my":"country ham","dui heo muoi kieu my":"country ham","lap xuong":"chinese sausage","cay lap xuong":"chinese sausage","lap suon":"chinese sausage","xuc xich y vi ngot":"sweet italian sausage","xuc xich y":"sweet italian sausage","xuc xich heo kieu y":"sweet italian sausage","xuc xich y vi cay":"hot italian sausage","xuc xich y cay":"hot italian sausage","xuc xich hun khoi andouille":"andouille sausage","xuc xich andouille":"andouille sausage","xuc xich chorizo":"chorizo","xuc xich cay chorizo":"chorizo","xuc xich kho tay ban nha chorizo":"spanish chorizo","xuc xich chorizo tay ban nha":"spanish chorizo","thit ga tay xay":"ground turkey","ga tay xay":"ground turkey","ga tay bam":"ground turkey","thit ga tay":"turkey","ga tay":"turkey","thit ga tay chin":"cooked turkey","ga tay quay chin":"cooked turkey","thit cuu xay":"ground lamb","cuu xay":"ground lamb","thit cuu bam":"ground lamb","dui cuu rut xuong":"boneless leg of lamb","thit dui cuu khong xuong":"boneless leg of lamb","suon cuu tang":"rib lamb chops","suon cuu":"rib lamb chops","de suon cuu":"rib lamb chops","dui cuu ham":"rib lamb chops","thit vai cuu":"boneless lamb shoulder","nac vai cuu":"boneless lamb shoulder","thit vit":"duck","vit":"duck","vit nguyen con":"duck","uc vit":"duck breast","thit uc vit":"duck breast","phi le uc vit":"duck breast","dui vit":"duck legs","thit dui vit":"duck legs","thit be xay":"ground veal","be xay":"ground veal","thit be bam":"ground veal","tom tuoi boc vo":"shrimp","tom su":"shrimp","tom the":"shrimp","tom boc vo rut chi":"shrimp peeled deveined","tom lam sach boc vo":"shrimp peeled deveined","tom non lam sach":"shrimp peeled deveined","tom nguyen vo":"shrimp in shell","tom con vo":"shrimp in shell","tom tuoi nguyen vo":"shrimp in shell","tom co lon":"jumbo shrimp","tom to":"jumbo shrimp","tom su lon":"jumbo shrimp","tom chin":"cooked shrimp","tom luoc chin":"cooked shrimp","tom hap chin":"cooked shrimp","tom kho":"dried shrimp","tom non kho":"dried shrimp","muc la":"squid","bach tuoc":"octopus","bach tuoc tuoi":"octopus","ca hoi":"salmon","ca hoi tuoi":"salmon","thit ca hoi":"salmon","phi le ca hoi":"salmon fillet","ca hoi phi le":"salmon fillet","mieng ca hoi phi le":"salmon fillet","phi le ca hoi bo da":"skinless salmon fillet","ca hoi phi le khong da":"skinless salmon fillet","ca hoi xong khoi":"smoked salmon","ca hoi hun khoi":"smoked salmon","ca tuyet":"cod fillet","ca tuyet tuoi":"cod fillet","phi le ca tuyet":"cod fillet","phi le ca bon halibut":"halibut fillet","ca bon":"halibut fillet","phi le ca bon":"halibut fillet","ca vuoc bien (ca chem)":"sea bass fillet with skin","ca chem":"sea bass fillet with skin","ca vuoc":"sea bass fillet with skin","phi le ca chem":"sea bass fillet with skin","ca hoi van trout":"smoked trout","ca hoi suoi":"smoked trout","phi le ca trout":"smoked trout","ca trout xong khoi":"smoked trout","ca ngu tuoi":"tuna steak","ca ngu":"tuna steak","phi le ca ngu":"tuna steak","ca ngu dong hop":"tuna in olive oil","ca ngu ngam dau":"tuna in olive oil","ca ngu hop":"tuna in olive oil","ca kiem cat lat":"swordfish steak","ca kiem":"swordfish steak","phi le ca kiem":"swordfish steak","ca hong":"snapper fillet","ca hong bien":"snapper fillet","phi le ca hong":"snapper fillet","phi le ca da tron":"catfish fillet","ca tre phi le":"catfish fillet","ca basa phi le":"catfish fillet","ca tra phi le":"catfish fillet","ca da tron":"catfish fillet","phi le ca ro phi":"tilapia fillet","ca ro phi":"tilapia fillet","ca dieu hong phi le":"tilapia fillet","ca trich / ca moi":"sardine","ca moi":"sardine","ca trich tuoi":"sardine","phi le ca com muoi":"anchovy fillet","ca com anchovy":"anchovy fillet","ca com ngam dau":"anchovy fillet","ca com muoi":"anchovy fillet","sot ca com nghien":"anchovy paste","mam ca com nghien":"anchovy paste","bot nhao ca com":"anchovy paste","so diep":"sea scallop","coi so diep":"sea scallop","so diep bien":"sea scallop","so diep tuoi":"sea scallop","ngeu / ngheu":"littleneck clam","ngeu":"littleneck clam","ngheu":"littleneck clam","ngheu tuoi":"littleneck clam","vem bien":"mussel","vem":"mussel","con vem":"mussel","vem xanh":"mussel","hau":"oyster","hau tuoi":"oyster","ruot hau":"oyster","con hau":"oyster","thit cua boc san":"lump crabmeat","thit cua":"lump crabmeat","thit ghe":"lump crabmeat","cua boc thit":"lump crabmeat","tom hum":"live lobster","tom hum tuoi":"live lobster","thit tom hum":"live lobster","qua trung ga":"egg","trung tuoi":"egg","long do trung":"egg yolk","long do trung ga":"egg yolk","long trang trung":"egg white","long trang trung ga":"egg white","trung luoc chin":"hard-boiled egg","trung ga luoc":"hard-boiled egg","qua trung cut":"quail egg","trung chim cut":"quail egg","dau phu cung":"firm tofu","dau hu cung":"firm tofu","dau phu chac":"firm tofu","dau khuon":"firm tofu","dau phu ep chac":"extra-firm tofu","dau hu ep chac":"extra-firm tofu","dau phu chien":"extra-firm tofu","dau hu non":"silken tofu","dau phu non":"silken tofu","dau phu lua":"silken tofu","tau hu non":"silken tofu","trai ca chua":"tomato","ca chua tuoi":"tomato","ca chua bi":"cherry tomato","ca chua cherry":"cherry tomato","qua ca chua bi":"cherry tomato","ca chua bi dai":"grape tomato","ca chua nho":"grape tomato","ca chua mui":"plum tomato","ca chua plum":"plum tomato","ca chua roma":"plum tomato","ca chua co dien nhieu mau":"heirloom tomato","ca chua heirloom":"heirloom tomato","ca chua qua lon beefsteak":"beefsteak tomato","ca chua to cat lat":"beefsteak tomato","ca chua dong hop nguyen qua":"tomato in juice","ca chua hop ngam nuoc ep":"tomato in juice","hanh tay tim":"red onion","hanh tay do":"red onion","cu hanh tay tim":"red onion","hanh tay trang":"white onion","cu hanh tay trang":"white onion","hanh tay vang":"yellow onion","cu hanh tay vang":"yellow onion","hanh tay ngot":"sweet onion","hanh tay vidalia":"sweet onion","hanh tay bi":"pearl onion","cu hanh bi":"pearl onion","hanh tay tim ngam chua":"pickled red onion","hanh tim muoi chua":"pickled red onion","toi tay":"leek","hanh boa-ro":"leek","hanh boa ro":"leek","boa ro":"leek","cay toi tay":"leek","hanh baro":"leek","ca rot bao tu":"baby carrot","ca rot non":"baby carrot","ca rot baby":"baby carrot","khoai tay russet":"russet potato","khoai tay vo nau bo":"russet potato","khoai tay yukon gold":"yukon gold potato","khoai tay vang yukon":"yukon gold potato","khoai tay vang":"yukon gold potato","khoai tay vo do":"red potato","khoai tay do":"red potato","khoai tay it bo":"waxy potato","khoai tay deo it bo":"waxy potato","khoai tay sap":"waxy potato","khoai lang song":"sweet potato","khoai lang mat":"sweet potato","nam mo":"mushroom","nam mo trang":"button mushroom","nam nut":"button mushroom","nam trang tron":"button mushroom","nam mo nau":"crimini mushroom","nam crimini":"crimini mushroom","nam cremini":"crimini mushroom","nam huong":"shiitake mushroom","nam dong co":"shiitake mushroom","nam huong tuoi":"shiitake mushroom","nam dong co tuoi":"shiitake mushroom","nam shiitake":"shiitake mushroom","nam portobello co lon":"portobello mushroom","nam portobello":"portobello mushroom","nam thong kho porcini":"dried porcini mushroom","nam porcini kho":"dried porcini mushroom","nam meo kho":"dried wood ear mushroom","moc nhi kho":"dried wood ear mushroom","tai nam meo kho":"dried wood ear mushroom","nam tong hop":"mixed mushroom","cac loai nam rung":"mixed mushroom","nam hon hop":"mixed mushroom","rau chan vit non":"baby spinach","cai bo xoi non":"baby spinach","rau chan vit dong lanh":"frozen spinach","cai bo xoi dong lanh":"frozen spinach","cay bong cai xanh":"broccoli","bong cai xanh than dai":"broccolini","sup lo xanh baby":"broccolini","cai ro bong":"broccolini","cai ngong y broccoli rabe":"broccoli rabe","cai ngong dang":"broccoli rabe","bong cai trang":"cauliflower","sup lo trang":"cauliflower","cay sup lo trang":"cauliflower","bap cai trang":"cabbage","bap cai tim":"red cabbage","cai bap tim":"red cabbage","bap cai do":"red cabbage","cai thao":"napa cabbage","bap cai thao":"napa cabbage","rau cai thao":"napa cabbage","bap cai xoan savoy":"savoy cabbage","bap cai nhan":"savoy cabbage","rau cai thia":"bok choy","cai chip":"bok choy","cai thia non":"baby bok choy","cai chip non":"baby bok choy","cai thia baby":"baby bok choy","cai ngot":"choy sum","rau cai ngot":"choy sum","cai xoan kale":"kale","rau cai xoan":"kale","cai kale":"kale","cai cau vong":"swiss chard","rau cai cau vong":"swiss chard","cai thuy si":"swiss chard","cai ro":"collard greens","rau cai ro":"collard greens","la cai ro":"collard greens","cai xoong":"watercress","rau cai xoong":"watercress","rau cai ten lua arugula":"arugula","xa lach rocket":"arugula","xa lach romaine":"romaine lettuce","xa lach lo lo":"romaine lettuce","rau xa lach":"romaine lettuce","xa lach":"romaine lettuce","xa lach gion iceberg":"iceberg lettuce","xa lach bup my":"iceberg lettuce","xa lach cuon":"iceberg lettuce","xa lach mo":"butter lettuce","xa lach bo":"butter lettuce","xa lach bibb":"butter lettuce","xa lach tim radicchio":"radicchio","rau diep tim y":"radicchio","rau diep xoan endive":"belgian endive","xa lach endive":"belgian endive","cai cuc dang au":"belgian endive","trai dua leo":"cucumber","qua dua chuot":"cucumber","dua leo khong hat":"seedless cucumber","dua chuot khong hat":"seedless cucumber","dua leo baby ba tu":"persian cucumber","dua chuot bao tu":"persian cucumber","dua leo mini":"persian cucumber","bi ngoi xanh":"zucchini","bi ngoi":"zucchini","qua bi ngoi":"zucchini","bi ngoi vang":"yellow squash","bi mua he vang":"yellow squash","bi do ho lo":"butternut squash","bi butternut":"butternut squash","bi ho lo":"butternut squash","bi do acorn":"acorn squash","bi soi":"acorn squash","bi do":"pumpkin","bi ngo":"pumpkin","qua bi do":"pumpkin","trai bi do":"pumpkin","bi do nghien dong hop":"canned pure pumpkin","bi ngo nghien":"canned pure pumpkin","sot bi do nguyen chat":"canned pure pumpkin","ca tim":"eggplant","qua ca tim":"eggplant","trai ca tim":"eggplant","qua ot chuong":"bell_pepper","ot ngot":"bell_pepper","qua ot chuong do":"red bell pepper","ot chuong xanh":"green bell pepper","qua ot chuong xanh":"green bell pepper","ot chuong vang":"yellow bell pepper","qua ot chuong vang":"yellow bell pepper","ot chuong cam":"orange bell pepper","qua ot chuong cam":"orange bell pepper","ot chuong do nuong":"roasted red bell_pepper","ot chuong do nuong dong lo":"roasted red bell_pepper","qua dau que":"green bean","dau co ve xanh":"green bean","dau ha lan":"pea","hat dau ha lan":"pea","dau ha lan tuoi":"pea","dau ha lan dong lanh":"frozen pea","hat dau ha lan dong lanh":"frozen pea","dau ha lan gion ngot":"sugar snap pea","dau ha lan an ca vo":"sugar snap pea","dau snap pea":"sugar snap pea","dau tuyet":"snow pea","dau ha lan det":"snow pea","dau van tuyet":"snow pea","gia do":"bean sprouts","gia":"bean sprouts","gia dau xanh":"bean sprouts","dau bap":"okra","qua dau bap":"okra","trai dau bap":"okra","ngo ngot":"corn","bap my":"corn","hat ngo ngot":"corn kernels","hat bap":"corn kernels","ngo tach hat":"corn kernels","ngo ngot dong lanh":"frozen corn","hat bap dong lanh":"frozen corn","mang tay":"asparagus","mang tay xanh":"asparagus","cong mang tay":"asparagus","can tay":"celery","rau can tay":"celery","cong can tay":"celery stalk","nhanh can tay":"celery stalk","than can tay":"celery stalk","cu can tay":"celery root","can tay cu":"celery root","cu celeriac":"celery root","cu tieu hoi":"fennel bulb","cu thi la tay":"fennel bulb","be tieu hoi":"fennel bulb","cu cai do tron":"radish","cu cai duong nho":"radish","cu cai do":"radish","cu cai trang":"daikon","cu cai":"daikon","cu cai trang nhat":"daikon","cu cai turnip":"turnip","cu cai trang tron au":"turnip","cu den":"beet","cu den do":"beet","cu cai den":"beet","cu cai vang parsnip":"parsnips","ca rot trang":"parsnips","cu parsnip":"parsnips","bap cai ti hon brussels":"brussels sprouts","bap cai mini":"brussels sprouts","cai bi brussels":"brussels sprouts","hoa atiso":"artichokes","atiso":"artichokes","bong atiso":"artichokes","toi bam nho":"garlic","toi tuoi":"garlic","cu hanh tim":"shallot","cu hanh kho":"shallot","hanh ta":"shallot","cong hanh la":"green_onion","hanh hoa":"green_onion","he tay":"chives","la he":"chives","he":"chives","cong he":"chives","nhanh gung nho":"ginger","gung tuoi":"ginger","gung bam":"ginger","gung nho":"ginger","cu sa":"lemongrass","sa bam":"lemongrass","sa cay":"lemongrass","nghe tuoi":"turmeric","cu nghe":"turmeric","nghe":"turmeric","rau ngo":"cilantro","mui ta":"cilantro","mui tay":"parsley","rau mui tay":"parsley","ngo tay":"parsley","mui tay la phang":"flat-leaf parsley","ngo tay la phang":"flat-leaf parsley","mui tay y":"flat-leaf parsley","hung que / hung tay":"basil","rau hung que":"basil","la hung tay":"basil","hung tay":"basil","hung que":"basil","la hung tay dong goi":"packaged basil leaf","hung tay tuoi dong goi":"packaged basil leaf","bac ha / hung lui":"mint","la bac ha":"mint","rau hung lui":"mint","hung lui":"mint","bac ha tuoi":"mint","la bac ha va mot nhanh de trang tri":"mint leaf plus sprig","thi la":"dill","rau thi la":"dill","la thi la":"dill","huong thao":"rosemary","la huong thao":"rosemary","nhanh huong thao":"rosemary","co xa huong thyme":"thyme","la xa huong":"thyme","xa huong tuoi":"thyme","kinh gioi cay oregano":"oregano","la oregano tuoi":"oregano","la xo thom sage":"sage","cay xo thom":"sage","xo thom":"sage","ngai giam tarragon":"tarragon","la ngai giam":"tarragon","rau ngai giam":"tarragon","kinh gioi ngot marjoram":"marjoram","la kinh gioi ngot":"marjoram","cac loai rau thom":"assorted herbs","rau thom hon hop":"assorted herbs","rau thom mem nhu thi la hoac mui tay":"tender herbs such as dill or parsley","la chanh thai":"kaffir lime leaf","la chanh":"kaffir lime leaf","la chanh chuc":"kaffir lime leaf","la ca ri tuoi":"curry leaf","la ca ri":"curry leaf","qua ot hiem":"thai chile","ot chi thien":"thai chile","ot cay":"thai chile","ot tuoi":"thai chile","ot do cay":"thai chile","ot jalapeno":"jalapeño","ot xanh mexico jalapeno":"jalapeño","ot serrano":"serrano chile","ot cay serrano":"serrano chile","ot poblano":"poblano chile","ot xanh poblano":"poblano chile","ot sung do":"red chile","ot do tuoi":"red chile","ot sung":"red chile","cu cai ngua horseradish":"horseradish","cai ngua mai":"horseradish","mu tat cu cai ngua":"horseradish","qua chanh vang":"lemon","trai chanh vang":"lemon","nuoc cot chanh vang":"lemon juice","nuoc chanh vang":"lemon juice","vo chanh vang bao":"lemon zest","vo chanh vang":"lemon zest","vo chanh bao":"lemon zest","chanh vang muoi":"preserved lemon","chanh muoi kieu ma-roc":"preserved lemon","chanh muoi kieu ma roc":"preserved lemon","trai chanh":"lime","chanh khong hat":"lime","nuoc cot chanh xanh":"lime juice","nuoc cot chanh":"lime juice","nuoc chanh tuoi":"lime juice","vo chanh xanh bao":"lime zest","vo chanh xanh":"lime zest","mui chanh xanh":"lime wedge","lat chanh xanh":"lime wedge","mieng chanh":"lime wedge","qua cam":"orange","trai cam":"orange","cam tuoi":"orange","nuoc cam":"orange juice","nuoc cam ep":"orange juice","nuoc cot cam":"orange juice","vo cam bao":"orange zest","vo cam":"orange zest","buoi chum grapefruit":"grapefruit","buoi dao":"grapefruit","buoi do":"grapefruit","qua buoi":"grapefruit","nuoc ep buoi":"grapefruit juice","nuoc buoi ep":"grapefruit juice","qua tao":"apple","trai tao":"apple","tao tuoi":"apple","tao xanh granny smith":"granny smith apple","tao xanh":"granny smith apple","qua tao xanh":"granny smith apple","nuoc ep tao":"apple juice","nuoc tao":"apple juice","sot tao nghien":"applesauce","tao nghien":"applesauce","qua chuoi":"banana","trai chuoi":"banana","chuoi chin":"banana","qua dau tay":"strawberry","trai dau tay":"strawberry","qua viet quat":"blueberry","phuc bon tu do":"raspberry","qua mam xoi do":"raspberry","phuc bon tu":"raspberry","mam xoi den":"blackberry","qua mam xoi den":"blackberry","dau tam den":"blackberry","nam viet quat tuoi":"cranberry","qua nam viet quat":"cranberry","nam viet quat kho":"dried cranberry","mut nam viet quat say":"dried cranberry","anh dao tuoi (cherry)":"cherry","qua cherry":"cherry","trai anh dao":"cherry","anh dao kho":"dried cherry","cherry say kho":"dried cherry","dao":"peach","qua dao":"peach","trai dao":"peach","dao chin":"peach","dao tron xuan dao":"nectarines","qua xuan dao":"nectarines","man":"plum","qua man":"plum","trai man":"plum","mo tuoi":"apricot","qua mo":"apricot","mo say kho":"dried apricot","qua mo kho":"dried apricot","xoai":"mango","qua xoai":"mango","trai xoai":"mango","xoai chin":"mango","dua":"pineapple","thom":"pineapple","khom":"pineapple","qua dua":"pineapple","trai thom":"pineapple","thom (dua)":"pineapple","qua thom (dua)":"pineapple","nuoc ep dua":"pineapple juice","nuoc thom ep":"pineapple juice","qua bo":"avocado","trai bo":"avocado","bo sap":"avocado","qua bo chin":"avocado","dua tuoi":"coconut","trai dua tuoi":"coconut","cui dua tuoi":"coconut","nuoc dua tuoi":"coconut water","nuoc dua":"coconut water","dua nao khong duong":"unsweetened coconut","com dua say khong duong":"unsweetened coconut","dua nao say co duong":"sweetened flaked coconut","dua say ngot":"sweetened flaked coconut","le":"pear","qua le":"pear","trai le":"pear","nho do khong hat":"seedless red grape","qua nho":"seedless red grape","nho tuoi":"seedless red grape","nho kho":"raisin","nho say kho":"raisin","nho kho vang":"golden raisin","nho vang say":"golden raisin","nho chuoi ngoc kho":"dried currant","nho den nho say kho":"dried currant","cha la":"date","qua cha la":"date","cha la say":"date","sung my tuoi":"fig","qua sung ngot":"fig","trai va":"fig","sung my say kho":"dried fig","qua sung kho":"dried fig","hat luu":"pomegranate seed","luu":"pomegranate seed","qua luu":"pomegranate seed","nuoc ep luu":"pomegranate juice","nuoc luu":"pomegranate juice","dai hoang rhubarb":"rhubarb","doc dai hoang":"rhubarb","qua huckleberry":"huckleberries","sua tuoi khong duong":"milk","sua nguyen kem":"whole milk","sua tuoi nguyen kem":"whole milk","sua dac co duong":"sweetened condensed milk","sua dac":"sweetened condensed milk","sua ong tho":"sweetened condensed milk","sua bo buttermilk":"buttermilk","sua len men buttermilk":"buttermilk","kem tuoi whipping":"heavy cream","kem sua beo":"heavy cream","kem tuoi danh bong":"whipped cream","kem bong":"whipped cream","kem sua pha half-and-half":"half-and-half","kem sua pha half and half":"half-and-half","sua kem half and half":"half-and-half","sot kem chua":"sour cream","kem chua phap creme fraiche":"crème fraîche","sua chua khong duong":"plain yogurt","sua chua":"plain yogurt","sua chua trang":"plain yogurt","sua chua hy lap":"plain greek yogurt","sua chua hy lap nguyen kem":"plain greek yogurt","bo khong muoi":"unsalted butter","bo nhat":"unsalted butter","bo man":"salted butter","bo co muoi":"salted butter","pho-mat":"cheese","pho mai kem (cream cheese)":"cream cheese","kem pho mai":"cream cheese","pho mai cream cheese":"cream cheese","pho mai parmesan":"parmesan cheese","pho mai bot parmesan":"parmesan cheese","parmesan bao":"parmesan cheese","pho mai mozzarella":"mozzarella cheese","pho mai keo soi":"mozzarella cheese","mozzarella bao":"mozzarella cheese","pho mai cheddar":"cheddar cheese","pho mai lat cheddar":"cheddar cheese","pho mai vang cheddar":"cheddar cheese","pho mai sua de":"goat cheese","pho mai feta":"feta cheese","pho mai man hy lap feta":"feta cheese","pho mai ricotta":"ricotta cheese","pho mai tuoi ricotta":"ricotta cheese","pho mai mascarpone":"mascarpone cheese","kem pho mai y mascarpone":"mascarpone cheese","pho mai gruyere":"gruyère cheese","pho mai thuy si gruyere":"gruyère cheese","pho mai cuu pecorino":"pecorino romano cheese","pho mai pecorino":"pecorino romano cheese","pho mai fontina":"fontina cheese","pho mai y fontina":"fontina cheese","pho mai monterey jack":"monterey jack cheese","pho mai tuoi burrata":"burrata cheese","pho mai burrata":"burrata cheese","kem lanh vi vani":"vanilla ice cream","com nong":"cooked rice","gao te hat dai":"long-grain white rice","gao trang":"long-grain white rice","gao te":"long-grain white rice","gao nau com":"long-grain white rice","gao thom jasmine":"jasmine rice","gao lai":"jasmine rice","gao thom thai":"jasmine rice","gao basmati an do":"basmati rice","gao hat dai basmati":"basmati rice","gao y arborio nau risotto":"arborio rice","gao risotto":"arborio rice","gao hat tron arborio":"arborio rice","gao nhat hat tron":"short-grain rice","gao sushi":"short-grain rice","gao hat ngan":"short-grain rice","gao den hoang da":"wild rice","gao lut den":"wild rice","vat mi trung":"egg noodle","mi soi trung":"egg noodle","mi trung kho ban rong":"dried wide egg noodle","mi trung soi det":"dried wide egg noodle","mi y spaghetti":"spaghetti","mi spaghetti":"spaghetti","mi y soi tron":"spaghetti","mi y soi det linguine":"linguine","mi linguine":"linguine","mi y ban rong fettuccine":"fettuccine","mi fettuccine":"fettuccine","nui ong penne":"penne","mi ong penne":"penne","nui ong":"penne","nui ong lon rigatoni":"rigatoni","mi ong rigatoni":"rigatoni","mi hat gao orzo":"orzo","nui hat gao":"orzo","mi ong / nui y":"pasta","mi y":"pasta","mi kieu mach soba":"soba noodle","mi soba nhat":"soba noodle","o banh mi":"bread","banh mi lat":"bread","banh mi phap baguette":"baguette","banh mi o dai":"baguette","banh mi que phap":"baguette","banh mi vo gion kieu que":"country-style bread","banh mi sourdough":"country-style bread","banh mi vo cung":"country-style bread","o banh mi phap de kho":"loaf of stale french bread","vo banh mi burger":"hamburger buns","banh mi tron kep thit":"hamburger buns","vun banh mi":"bread crumbs","bot chien xu min":"bread crumbs","bot chien xu nhat (panko)":"panko","bot chien xu":"panko","vun banh mi panko":"panko","banh trang ngo tortilla":"corn tortilla","vo banh taco ngo":"corn tortilla","banh tortilla bap":"corn tortilla","vo banh cuon bot mi tortilla":"flour tortilla","banh tortilla bot mi":"flour tortilla","vo banh burrito":"flour tortilla","banh ngo chien gion nachos":"tortilla chips","banh snack ngo":"tortilla chips","banh nachos":"tortilla chips","khoai tay lat chien gion":"potato chips","bimbim khoai tay":"potato chips","vo banh ngan lop dong lanh":"frozen puff pastry","bot ngan lop puff pastry":"frozen puff pastry","bot my":"flour","bot mi so 11":"all-purpose flour","bot mi thuong":"all-purpose flour","bot mi da dung khong tay trang":"unbleached all-purpose flour","bot mi tu no":"self-rising flour","bot mi pha san bot no":"self-rising flour","bot mi lam banh mi (so 13)":"bread flour","bot banh mi":"bread flour","bot mi lam banh bong lan (so 8)":"cake flour","bot lam banh ngot":"cake flour","bot cake flour":"cake flour","bot mi nguyen cam":"whole wheat flour","bot mi den nguyen cam":"whole wheat flour","bot gao":"rice flour","bot gao te":"rice flour","bot dau ga":"chickpea flour","bot gram an do":"chickpea flour","bot bap (tinh bot ngo)":"cornstarch","bot bap":"cornstarch","tinh bot ngo":"cornstarch","bot ngo":"cornstarch","tinh bot khoai tay":"potato starch","bot khoai tay":"potato starch","bot ngo hat tam":"cornmeal","bot bap hat tho":"cornmeal","bot ngo nau polenta":"polenta","bot bap y polenta":"polenta","yen mach can det":"old-fashioned oats","yen mach":"old-fashioned oats","hat yen mach":"old-fashioned oats","hat diem mach (quinoa)":"quinoa","diem mach":"quinoa","hat quinoa":"quinoa","hat bot mi couscous":"couscous","hat couscous":"couscous","lua mi nut bulgur":"bulgur","hat lua mi bulgur":"bulgur","hat lua mi co dai farro":"farro","lua mach farro":"farro","hat y di / lua mach vo tron":"pearl barley","hat bo bo":"pearl barley","lua mach":"pearl barley","vun banh quy graham":"graham cracker crumbs","banh quy nghien lam de banh":"graham cracker crumbs","bot banh quy khong men matzo":"matzo meal","bot banh matzo":"matzo meal","dau den":"black bean","hat dau den":"black bean","do den":"black bean","dau trang":"white bean","hat dau trang":"white bean","dau trang y cannellini":"cannellini bean","dau cannellini":"cannellini bean","dau cut pinto":"pinto bean","dau dom pinto":"pinto bean","dau ga":"chickpea","hat dau ga":"chickpea","dau lang do":"red lentil","hat dau lang":"red lentil","dau lang":"red lentil","dau trang mat den":"black-eyed pea","dau mat den":"black-eyed pea","dau nanh nhat edamame":"frozen shelled edamame","dau tuong long":"frozen shelled edamame","dau edamame":"frozen shelled edamame","hanh nhan":"almond","hat hanh nhan":"almond","hat oc cho":"walnut","qua oc cho":"walnut","nhan hat oc cho":"walnut","hat ho dao":"pecan","hat ho dao pecan":"pecan","qua ho dao":"pecan","hat de cuoi":"pistachio","qua ho tran":"pistachio","nhan hat de cuoi":"pistachio","hat phi hazelnut":"hazelnut","hat phi":"hazelnut","hat thong":"pine nuts","nhan hat thong":"pine nuts","dau phong (lac)":"peanut","dau phong":"peanut","lac":"peanut","hat lac":"peanut","dau phong rang":"peanut","hat dieu":"cashew","hat dieu rang":"cashew","nhan hat dieu":"cashew","hat me (vung)":"sesame seed","me trang":"sesame seed","vung trang":"sesame seed","hat vung":"sesame seed","hat me":"sesame seed","hat me den (vung den)":"black sesame seed","me den":"black sesame seed","vung den":"black sesame seed","hat bi xanh":"pumpkin seed","hat bi":"pumpkin seed","nhan hat bi ngo":"pumpkin seed","hat chia":"chia seed","hat chia den":"chia seed","hat anh tuc lam banh":"poppy seed","hat poppy":"poppy seed","nuoc mam ngon":"fish sauce","mam":"fish sauce","nuoc tuong (xi dau)":"soy sauce","nuoc tuong it muoi":"low-sodium soy sauce","xi dau giam man":"low-sodium soy sauce","nuoc tuong den dam dac":"dark soy sauce","hac xi dau":"dark soy sauce","xi dau den":"dark soy sauce","sot dau hao":"oyster sauce","tuong den hoisin":"hoisin sauce","sot hoisin":"hoisin sauce","tuong ngot an pho":"hoisin sauce","tuong ot sriracha":"sriracha","tuong ot":"sriracha","sot ot cay sriracha":"sriracha","tuong ot toi":"chili-garlic sauce","sot ot toi":"chili-garlic sauce","tuong ot han quoc gochujang":"gochujang","sot ot han quoc":"gochujang","tuong gochujang":"gochujang","kim chi cai thao":"kimchi","kimchi han quoc":"kimchi","tuong miso trang":"white miso","tuong dau nanh nhat miso":"white miso","tuong miso":"white miso","ruou gia vi nhat mirin":"mirin","ruou ngot mirin":"mirin","ruou sake nau an":"sake","ruou gao nhat sake":"sake","sot bo me tahini":"tahini","bo vung tahini":"tahini","sot me nghien":"tahini","bo dau phong":"peanut butter","bo lac":"peanut butter","sot mayonnaise":"mayonnaise","sot mayo":"mayonnaise","xot mayonnaise":"mayonnaise","tuong ca (ketchup)":"ketchup","tuong ca":"ketchup","sot ca chua ketchup":"ketchup","ca chua co dac (tomato paste)":"tomato paste","sot ca chua dac":"tomato paste","ca chua nhuyen co dac":"tomato paste","sot ca chua":"tomato sauce","nuoc sot ca chua":"tomato sauce","mu tat vang dijon":"dijon mustard","mu tat phap dijon":"dijon mustard","sot mu tat":"dijon mustard","mu tat nguyen hat":"whole-grain mustard","mu tat hat":"whole-grain mustard","sot worcestershire":"worcestershire sauce","nuoc sot anh worcestershire":"worcestershire sauce","sot ot cay":"hot sauce","tuong ot cay tabasco":"hot sauce","tuong ot bac phi harissa":"harissa paste","sot ot harissa":"harissa paste","nu bach hoa ngam (capers)":"caper","nu bach hoa":"caper","hat caper":"caper","dua chuot bao tu muoi chua":"cornichons","dua leo muoi chua":"cornichons","dua chuot muoi":"cornichons","vat me chua":"tamarind","cot me":"tamarind","nuoc cot me":"tamarind","mat luu co dac":"pomegranate molasses","sot mat luu":"pomegranate molasses","dau chien":"vegetable oil","dau olive":"olive oil","dau o liu nguyen chat":"extra-virgin olive oil","dau olive nguyen chat ep lanh":"extra-virgin olive oil","dau cai":"canola oil","dau hat cai":"canola oil","dau dau phong":"peanut oil","dau lac":"peanut oil","dau ngo":"corn oil","dau ngo bap":"corn oil","dau hat nho":"grapeseed oil","dau dua":"coconut oil","dau dua nguyen chat":"coconut oil","dau me (dau vung)":"sesame oil","dau me":"sesame oil","dau vung":"sesame oil","dau me thom":"sesame oil","giam trang":"distilled white vinegar","giam an":"distilled white vinegar","giam gao trang":"distilled white vinegar","giam gao":"rice vinegar","giam gao nhat":"rice vinegar","giam tao":"apple cider vinegar","dam tao":"apple cider vinegar","giam ruou vang do":"red wine vinegar","giam vang do":"red wine vinegar","giam ruou vang trang":"white wine vinegar","giam vang trang":"white wine vinegar","giam den balsamic":"balsamic vinegar","giam balsamic y":"balsamic vinegar","giam ruou sherry":"sherry vinegar","giam sherry":"sherry vinegar","nuoc cot dua":"coconut milk","sua dua":"coconut milk","nuoc cot dua lon":"coconut milk","ruou vang trang":"dry white wine","vang trang nau an":"dry white wine","ruou vang do":"dry red wine","vang do nau an":"dry red wine","ruou sherry nau an":"dry sherry","ruou vang sherry":"dry sherry","ruou vermouth kho":"dry vermouth","ruou mui vermouth":"dry vermouth","ruou vodka":"vodka","ruou rum trang":"white rum","ruou rum":"white rum","ruou whisky bourbon":"bourbon","ruou bourbon":"bourbon","ruou manh brandy / cognac":"brandy","ruou brandy":"brandy","ruou cognac":"brandy","ruou gin":"gin","ruou dang campari":"campari","ruou mui st-germain":"st-germain","ruou mui st germain":"st-germain","muoi an":"salt","muoi tinh":"salt","muoi kosher":"kosher salt","muoi hat kosher":"kosher salt","muoi bien":"sea salt","muoi hat bien":"sea salt","muoi bien dang vay, nhu maldon":"flaky sea salt such as maldon","muoi bien dang vay, uu tien fleur de sel":"flaky sea salt, preferably fleur de sel","ho tieu":"pepper","tieu den":"black pepper","hat tieu den":"black pepper","tieu den xay":"ground black pepper","hat tieu xay":"ground black pepper","tieu den vua xay":"ground black pepper","tieu trang xay":"ground white pepper","tieu so":"ground white pepper","tieu trang":"ground white pepper","hat tieu so":"ground white pepper","hoa tieu tu xuyen":"sichuan peppercorns","tieu tu xuyen":"sichuan peppercorns","mac khen / hoa tieu":"sichuan peppercorns","ot kho dang manh (chili flakes)":"red pepper flakes","ot bot manh":"red pepper flakes","ot manh kho":"red pepper flakes","ot bot":"chili powder","bot ot":"chili powder","ot bot min":"chili powder","ot bot cay cayenne":"cayenne pepper","bot ot cayenne":"cayenne pepper","tieu cayenne":"cayenne pepper","bot ot ngot paprika":"paprika","ot bot paprika":"paprika","bot ot paprika hun khoi":"smoked paprika","paprika xong khoi":"smoked paprika","bot thi la ai cap (cumin)":"ground cumin","bot cumin":"ground cumin","thi la ai cap xay":"ground cumin","hat thi la ai cap (cumin)":"cumin seed","hat cumin":"cumin seed","bot hat mui (ngo)":"ground coriander","bot hat ngo":"ground coriander","hat mui xay":"ground coriander","hat mui kho (hat ngo)":"coriander seed","hat ngo":"coriander seed","hat mui":"coriander seed","bot nghe":"ground turmeric","tinh bot nghe":"ground turmeric","bot ca ri":"curry powder","gia vi ca ri":"curry powder","bot gia vi an do garam masala":"garam masala","gia vi garam masala":"garam masala","bot ngu vi huong":"chinese five-spice powder","ngu vi huong":"chinese five-spice powder","goi ngu vi huong":"chinese five-spice powder","bot que":"ground cinnamon","que xay":"ground cinnamon","que":"cinnamon","thanh que":"cinnamon","que cay":"cinnamon","vo que":"cinnamon","hoa hoi (dai hoi)":"whole star anise","hoa hoi":"whole star anise","dai hoi":"whole star anise","canh hoi":"whole star anise","bot thao qua / bach dau khau":"ground cardamom","bot bach dau khau":"ground cardamom","bot nhuc dau khau":"ground nutmeg","nhuc dau khau":"ground nutmeg","hat nhuc dau khau":"ground nutmeg","bot dinh huong":"ground clove","dinh huong":"ground clove","nu dinh huong":"ground clove","bot tieu jamaica":"ground allspice","tieu jamaica":"ground allspice","bot gung kho":"ground ginger","bot gung":"ground ginger","bot toi":"garlic powder","toi bot":"garlic powder","bot hanh tay":"onion powder","bot hanh":"onion powder","bot mu tat kho":"dry mustard","mu tat bot":"dry mustard","hat mu tat":"mustard seed","hat cai mu tat":"mustard seed","hat tieu hoi":"fennel seed","hat thi la tay":"fennel seed","hat caraway":"caraway seed","hat thi la ba tu":"caraway seed","hat can tay":"celery seed","muoi can tay":"celery seed","la nguyet que":"bay leaf","la thom nguyet que":"bay leaf","la bay leaf":"bay leaf","la oregano kho":"dried oregano","kinh gioi cay kho":"dried oregano","la xa huong kho (thyme kho)":"dried thyme","co xa huong kho":"dried thyme","la huong thao kho":"dried rosemary","huong thao kho":"dried rosemary","la hung tay kho":"dried basil","basil kho":"dried basil","nhuy hoa nghe tay (saffron)":"saffron threads","nhuy nghe tay":"saffron threads","nghe tay":"saffron threads","bot gia vi chua sumac":"sumac","gia vi sumac":"sumac","qua bach xu kho":"juniper berries","hat bach xu":"juniper berries","bot gia vi banh bi do":"pumpkin pie spice","gia vi banh bi ngo":"pumpkin pie spice","nuoc dung ga":"chicken broth","nuoc ham ga":"chicken broth","nuoc luoc ga":"chicken broth","nuoc dung ga it muoi":"low-salt chicken broth","nuoc dung ga giam man":"low-salt chicken broth","nuoc dung bo":"beef broth","nuoc ham xuong bo":"beef broth","nuoc dung rau cu":"vegetable broth","nuoc ham rau cu chay":"vegetable broth","nuoc luoc ngheu dong chai":"clam juice","nuoc dung ngheu / hai san":"clam juice","tao be kho nhat (kombu)":"dried kombu","rong bien kombu nau dashi":"dried kombu","tao be kombu":"dried kombu","nuoc":"water","nuoc loc":"water","nuoc sach":"water","duong trang":"sugar","duong kinh":"sugar","duong cat":"granulated sugar","duong cat trang":"granulated sugar","duong nau":"brown sugar","duong do":"brown sugar","duong vang":"brown sugar","duong nau nhat":"light brown sugar","duong nau sang mau":"light brown sugar","duong nau sam":"dark brown sugar","duong den han quoc":"dark brown sugar","duong bot":"powdered sugar","duong xay":"powdered sugar","duong icing":"powdered sugar","mat ong":"honey","mat ong rung":"honey","mat ong nguyen chat":"honey","siro la phong (maple syrup)":"pure maple syrup","siro cay phong":"pure maple syrup","mat cay thua (agave)":"agave nectar","mat mia den (molasses)":"molasses","mat mia":"molasses","mat duong":"molasses","siro ngo (corn syrup)":"light corn syrup","mach nha ngo":"light corn syrup","siro bap":"light corn syrup","bot no":"baking powder","bot no (baking powder)":"baking powder","bot noi":"baking powder","muoi no":"baking soda","muoi no (baking soda)":"baking soda","bot baking soda":"baking soda","men no kho (dry yeast)":"active dry yeast","men lam banh mi":"active dry yeast","men no":"active dry yeast","bot on dinh long trang trung (cream of tartar)":"cream of tartar","bot tartar":"cream of tartar","bot gelatin khong mui":"unflavored gelatin","la gelatin":"unflavored gelatin","bot gelatin":"unflavored gelatin","huong vani":"vanilla","chiet xuat vani":"vanilla extract","tinh chat vani":"vanilla extract","chiet xuat vani nguyen chat":"pure vanilla extract","qua vani nguyen trai":"vanilla bean","nhanh vani":"vanilla bean","sot vani":"vanilla bean","chiet xuat hanh nhan":"almond extract","tinh chat hanh nhan":"almond extract","chiet xuat bac ha":"peppermint extract","tinh chat bac ha lam banh":"peppermint extract","nuoc hoa hong thuc pham":"rose water","nuoc cat hoa hong":"rose water","nuoc hoa cam":"rose water","bot ca cao khong duong":"unsweetened cocoa powder","bot cacao":"unsweetened cocoa powder","bot ca cao nguyen chat":"unsweetened cocoa powder","so-co-la":"chocolate","so co la":"chocolate","so-co-la den":"dark chocolate","so co la den":"dark chocolate","socola den":"dark chocolate","so-co-la dang (bittersweet)":"bittersweet chocolate","so co la dang (bittersweet)":"bittersweet chocolate","socola dang 70%":"bittersweet chocolate","so-co-la ban ngot":"semisweet chocolate","so co la ban ngot":"semisweet chocolate","so-co-la lam banh":"semisweet chocolate","so co la lam banh":"semisweet chocolate","so-co-la ban ngot chat luong tot":"good-quality semisweet chocolate","so co la ban ngot chat luong tot":"good-quality semisweet chocolate","so-co-la trang":"white chocolate","so co la trang":"white chocolate","socola trang":"white chocolate","bot ca phe espresso hoa tan":"instant espresso powder","bot ca phe den":"instant espresso powder","ca phe espresso pha san":"brewed espresso","ca phe den pha dam":"brewed espresso","kem trung lam banh":"pastry cream","mo thuc vat lam banh (shortening)":"vegetable shortening","bo thuc vat shortening":"vegetable shortening","mut gung ket tinh":"crystallized ginger","mut gung kho":"crystallized ginger","mut vo cam":"candied orange peel","vo cam sen duong":"candied orange peel","mut cam marmalade":"orange marmalade","mut vo cam deo":"orange marmalade","mut mo":"apricot preserves","mut qua mo":"apricot preserves","mut phuc bon tu":"raspberry jam","mut dau mam xoi":"raspberry jam","raw chicken":"chicken","chicken breasts":"chicken breast","skinless boneless chicken breast":"boneless skinless chicken breast","skinless boneless chicken breast halves":"boneless skinless chicken breast","boneless, skinless chicken breast":"boneless skinless chicken breast","skinless, boneless chicken breast":"boneless skinless chicken breast","boneless skinless chicken thighs":"skinless boneless chicken thigh","chicken thighs":"chicken thigh","skin-on, bone-in chicken thigh":"bone-in skin-on chicken thigh","skin on, bone in chicken thigh":"bone-in skin-on chicken thigh","bone-in, skin-on chicken thigh":"bone-in skin-on chicken thigh","bone in, skin on chicken thigh":"bone-in skin-on chicken thigh","chicken wings":"chicken wing","chicken drumsticks":"chicken drumstick","chicken leg":"chicken legs","chicken tender":"chicken tenders","chicken tenderloin":"chicken tenders","chicken liver":"chicken livers","shredded cooked chicken":"cooked chicken","minced chicken":"ground chicken","minced beef":"ground beef","beef filet":"beef tenderloin","beef flank steak":"flank steak","beef skirt steak":"skirt steak","ribeye steak":"rib-eye steak","minced pork":"ground pork","pork loin roast":"boneless pork loin","boston butt":"pork shoulder","pork chop":"bone-in pork chops","bone-in pork chop":"bone-in pork chops","bone in pork chop":"bone-in pork chops","sliced bacon":"bacon","thinly sliced prosciutto":"prosciutto","diced cooked ham":"cooked ham","chinese sausages":"chinese sausage","spicy italian sausage":"hot italian sausage","mexican chorizo":"chorizo","minced turkey":"ground turkey","minced lamb":"ground lamb","leg of lamb":"boneless leg of lamb","lamb rack":"rib lamb chops","whole duck":"duck","duck breasts":"duck breast","magret duck breast":"duck breast","duck leg":"duck legs","minced veal":"ground veal","shrimps":"shrimp","raw shrimp":"shrimp","uncooked shrimp":"shrimp","prawn":"shrimp","shrimp, peeled, deveined":"shrimp peeled deveined","peeled and deveined shrimp":"shrimp peeled deveined","shrimp , peeled, deveined":"shrimp peeled deveined","uncooked shrimp, peeled, deveined":"shrimp peeled deveined","large shrimp":"jumbo shrimp","baby octopus":"octopus","fresh salmon":"salmon","salmon fillets":"salmon fillet","skinless salmon fillets":"skinless salmon fillet","thinly sliced smoked salmon":"smoked salmon","cod":"cod fillet","cod fillets":"cod fillet","halibut fillets":"halibut fillet","sea bass":"sea bass fillet with skin","black sea bass":"sea bass fillet with skin","striped bass":"sea bass fillet with skin","trout":"smoked trout","rainbow trout":"smoked trout","ahi tuna":"tuna steak","tuna steaks":"tuna steak","yellowfin tuna":"tuna steak","canned tuna":"tuna in olive oil","swordfish steaks":"swordfish steak","snapper":"snapper fillet","red snapper":"snapper fillet","catfish":"catfish fillet","catfish fillets":"catfish fillet","tilapia":"tilapia fillet","tilapia fillets":"tilapia fillet","fresh sardines":"sardine","sardines":"sardine","anchovies":"anchovy fillet","anchovy fillets":"anchovy fillet","scallops":"sea scallop","sea scallops":"sea scallop","bay scallops":"sea scallop","clams":"littleneck clam","littleneck clams":"littleneck clam","manila clams":"littleneck clam","mussels":"mussel","oysters":"oyster","shucked oysters":"oyster","crab meat":"lump crabmeat","crab":"lump crabmeat","eggs":"egg","large egg":"egg","egg yolks":"egg yolk","egg whites":"egg white","hard-boiled eggs":"hard-boiled egg","hard boiled eggs":"hard-boiled egg","quail eggs":"quail egg","firm bean curd":"firm tofu","tomatoes":"tomato","cherry tomatoes":"cherry tomato","grape tomatoes":"grape tomato","plum tomatoes":"plum tomato","roma tomatoes":"plum tomato","heirloom tomatoes":"heirloom tomato","beefsteak tomatoes":"beefsteak tomato","canned whole tomatoes":"tomato in juice","onions":"onion","red onions":"red onion","white onions":"white onion","yellow onions":"yellow onion","pearl onions":"pearl onion","leeks":"leek","carrots":"carrot","baby carrots":"baby carrot","potatoes":"potato","russet potatoes":"russet potato","yukon gold potatoes":"yukon gold potato","red potatoes":"red potato","sweet potatoes":"sweet potato","mushrooms":"mushroom","button mushrooms":"button mushroom","crimini mushrooms":"crimini mushroom","cremini mushrooms":"crimini mushroom","shiitake mushrooms":"shiitake mushroom","fresh shiitake mushrooms":"shiitake mushroom","portobello mushrooms":"portobello mushroom","wood ear mushroom":"dried wood ear mushroom","black fungus":"dried wood ear mushroom","spinach leaf":"spinach","spinach leaves":"spinach","fresh spinach":"spinach","baby spinach leaf":"baby spinach","baby spinach leaves":"baby spinach","broccoli florets":"broccoli","cauliflower florets":"cauliflower","chinese cabbage":"napa cabbage","pak choi":"bok choy","anghai bok choy":"baby bok choy","yu choy":"choy sum","chard":"swiss chard","collards":"collard greens","endive":"belgian endive","cucumbers":"cucumber","persian cucumbers":"persian cucumber","courgette":"zucchini","fresh pumpkin":"pumpkin","eggplants":"eggplant","aubergine":"eggplant","bell peppers":"bell_pepper","red bell peppers":"red bell pepper","green bell peppers":"green bell pepper","yellow bell peppers":"yellow bell pepper","orange bell peppers":"orange bell pepper","roasted red peppers":"roasted red bell_pepper","green beans":"green bean","string beans":"green bean","peas":"pea","green peas":"pea","english peas":"pea","frozen peas":"frozen pea","frozen petite peas":"frozen pea","sugar snap peas":"sugar snap pea","snap peas":"sugar snap pea","snow peas":"snow pea","chinese pea pods":"snow pea","bean sprout":"bean sprouts","fresh okra":"okra","ear of corn":"corn","ears of corn":"corn","sweet corn":"corn","ears corn":"corn","fresh corn kernels":"corn kernels","celery stalks":"celery stalk","radishes":"radish","turnips":"turnip","beets":"beet","beetroot":"beet","brussels sprout":"brussels sprouts","artichoke":"artichokes","garlic clove":"garlic","garlic cloves":"garlic","cloves garlic":"garlic","shallots":"shallot","green onions":"green_onion","scallion":"green_onion","scallions":"green_onion","spring onion":"green_onion","spring onions":"green_onion","fresh chives":"chives","fresh ginger":"ginger","peeled fresh ginger":"ginger","lemongrass stalks":"lemongrass","fresh cilantro":"cilantro","coriander leaves":"cilantro","fresh parsley":"parsley","fresh basil":"basil","fresh mint":"mint","fresh dill":"dill","dill sprigs":"dill","fresh rosemary":"rosemary","fresh thyme":"thyme","fresh oregano":"oregano","fresh sage":"sage","fresh tarragon":"tarragon","fresh marjoram":"marjoram","lime leaves":"kaffir lime leaf","fresh curry leaves":"curry leaf","thai chiles":"thai chile","birds eye chili":"thai chile","serrano pepper":"serrano chile","fresh poblano chile":"poblano chile","lemons":"lemon","fresh lemon juice":"lemon juice","grated lemon zest":"lemon zest","limes":"lime","squeezed lime juice":"lime juice","fresh lime juice":"lime juice","freshly squeezed lime juice":"lime juice","grated lime zest":"lime zest","lime wedges":"lime wedge","oranges":"orange","fresh orange juice":"orange juice","grated orange zest":"orange zest","apples":"apple","bananas":"banana","strawberries":"strawberry","fresh strawberries":"strawberry","blueberries":"blueberry","fresh blueberries":"blueberry","raspberries":"raspberry","blackberries":"blackberry","cranberries":"cranberry","fresh cranberries":"cranberry","dried cranberries":"dried cranberry","craisins":"dried cranberry","cherries":"cherry","sweet cherries":"cherry","dried cherries":"dried cherry","peaches":"peach","plums":"plum","apricots":"apricot","dried apricots":"dried apricot","fresh pineapple":"pineapple","avocados":"avocado","pears":"pear","grapes":"seedless red grape","green grapes":"seedless red grape","raisins":"raisin","golden raisins":"golden raisin","dried currants":"dried currant","currants":"dried currant","dates":"date","figs":"fig","fresh figs":"fig","dried figs":"dried fig","fresh rhubarb":"rhubarb","huckleberry":"huckleberries","creme fraiche":"crème fraîche","cheeses":"cheese","cheddar":"cheddar cheese","chèvre":"goat cheese","chevre":"goat cheese","gruyere":"gruyère cheese","gruyère":"gruyère cheese","gruyere cheese":"gruyère cheese","burrata":"burrata cheese","carnaroli rice":"arborio rice","egg noodles":"egg noodle","macaroni":"pasta","soba noodles":"soba noodle","buckwheat noodles":"soba noodle","breads":"bread","white bread":"bread","corn tortillas":"corn tortilla","flour tortillas":"flour tortilla","puff pastry sheets":"frozen puff pastry","all purpose flour":"all purpose flour","besan":"chickpea flour","black beans":"black bean","canned black beans":"black bean","white beans":"white bean","navy beans":"white bean","cannellini beans":"cannellini bean","pinto beans":"pinto bean","chickpeas":"chickpea","garbanzo beans":"chickpea","lentils":"red lentil","brown lentils":"red lentil","green lentils":"red lentil","french green lentils":"red lentil","black-eyed peas":"black-eyed pea","black eyed peas":"black-eyed pea","edamame":"frozen shelled edamame","almonds":"almond","sliced almonds":"almond","walnuts":"walnut","pecans":"pecan","pistachios":"pistachio","shelled pistachios":"pistachio","hazelnuts":"hazelnut","pine nut":"pine nuts","pignoli":"pine nuts","peanuts":"peanut","cashews":"cashew","raw cashews":"cashew","roasted cashews":"cashew","sesame seeds":"sesame seed","toasted sesame seeds":"sesame seed","black sesame seeds":"black sesame seed","chia seeds":"chia seed","poppy seeds":"poppy seed","hoisin":"hoisin sauce","yellow miso":"white miso","sweetened mirin":"mirin","japanese sake":"sake","frank's redhot":"hot sauce","capers":"caper","drained capers":"caper","freshly ground black pepper":"ground black pepper","crushed red pepper":"red pepper flakes","cumin seeds":"cumin seed","coriander seeds":"coriander seed","cloves":"ground clove","whole cloves":"ground clove","mustard seeds":"mustard seed","fennel seeds":"fennel seed","caraway seeds":"caraway seed","bay leaves":"bay leaf"});

const EXTRA_VI_DISPLAY = Object.freeze({"green onion":"hành lá","green_onion":"hành lá","ground pork":"thịt heo xay","pork belly":"thịt ba rọi","pork ribs":"sườn heo","cooked rice":"cơm nguội","shallot":"hành tím","ginger":"gừng","lemongrass":"sả","cilantro":"ngò rí","broccoli":"bông cải xanh","cabbage":"bắp cải","bok choy":"cải thìa","cucumber":"dưa leo","bell pepper":"ớt chuông","bell_pepper":"ớt chuông","red bell pepper":"ớt chuông đỏ","thai chile":"ớt hiểm","fish sauce":"nước mắm","soy sauce":"nước tương","oyster sauce":"dầu hào","egg noodle":"mì trứng","quail egg":"trứng cút","squid":"mực","dried wood ear mushroom":"nấm mèo","thịt heo":"thịt heo","pork":"thịt heo","tofu":"đậu hũ","beef":"thịt bò","cá":"cá","fish":"cá","hành":"hành"});

const DEFAULT_CATALOG_CATEGORIES = Object.freeze([{"id":"protein_meat","label_vi":"Thịt & Gia cầm","label_en":"Meat & Poultry","order":1},{"id":"seafood","label_vi":"Thủy hải sản","label_en":"Seafood","order":2},{"id":"egg_tofu","label_vi":"Trứng & Đậu phụ","label_en":"Eggs & Tofu","order":3},{"id":"vegetables","label_vi":"Rau củ & Nấm","label_en":"Vegetables & Mushrooms","order":4},{"id":"herbs_aromatics","label_vi":"Rau thơm & Gia vị tươi","label_en":"Fresh Herbs & Aromatics","order":5},{"id":"fruits","label_vi":"Trái cây","label_en":"Fruits","order":6},{"id":"dairy_cheese","label_vi":"Sữa, Bơ & Phô mai","label_en":"Dairy, Butter & Cheese","order":7},{"id":"grains_noodles_bread","label_vi":"Tinh bột, Mì & Bánh","label_en":"Grains, Rice, Noodles & Bread","order":8},{"id":"legumes_nuts_seeds","label_vi":"Đậu, Hạt & Ngũ cốc","label_en":"Beans, Nuts & Seeds","order":9},{"id":"sauces_condiments_oils","label_vi":"Nước chấm, Sốt & Dầu","label_en":"Sauces, Condiments & Oils","order":10},{"id":"spices_seasonings","label_vi":"Gia vị khô & Thảo mộc","label_en":"Spices, Seasonings & Broths","order":11},{"id":"baking_sweeteners","label_vi":"Làm bánh & Đồ ngọt","label_en":"Baking, Sweeteners & Chocolate","order":12}]);

const COMPACT_CATALOG_ITEMS = Object.freeze([["ing_0001_chicken","chicken","thịt gà","chicken","protein_meat",50,["gà","thịt gà sống","thịt gà chặt miếng","gà chặt miếng","gà ta"],["thit ga","ga","thit ga song","thit ga chat mieng","ga chat mieng","ga ta"],["raw chicken"],true],["ing_0002_chicken_breast","chicken breast","ức gà","chicken breast","protein_meat",2,["thịt ức gà","ức gà phi lê","phi lê ức gà"],["uc ga","thit uc ga","uc ga phi le","phi le uc ga"],["chicken breasts"],true],["ing_0003_boneless_skinless_chicken_breast","boneless skinless chicken breast","ức gà rút xương bỏ da","boneless skinless chicken breast","protein_meat",1,["ức gà không xương không da","ức gà phi lê không da"],["uc ga rut xuong bo da","uc ga khong xuong khong da","uc ga phi le khong da"],["skinless boneless chicken breast","skinless boneless chicken breast halves","boneless, skinless chicken breast","skinless, boneless chicken breast"],false],["ing_0004_skinless_boneless_chicken_thigh","skinless boneless chicken thigh","đùi gà rút xương bỏ da","skinless boneless chicken thigh","protein_meat",23,["thịt đùi gà rút xương","đùi gà phi lê"],["dui ga rut xuong bo da","thit dui ga rut xuong","dui ga phi le"],["boneless skinless chicken thigh","boneless skinless chicken thighs"],false],["ing_0005_chicken_thigh","chicken thigh","đùi gà","chicken thigh","protein_meat",6,["thịt đùi gà","má đùi gà"],["dui ga","thit dui ga","ma dui ga"],["chicken thighs"],false],["ing_0006_bone_in_skin_on_chicken_thigh","bone-in skin-on chicken thigh","đùi gà nguyên xương có da","bone-in skin-on chicken thigh","protein_meat",1,["đùi gà có xương có da"],["dui ga nguyen xuong co da","dui ga co xuong co da"],["skin-on, bone-in chicken thigh","bone-in, skin-on chicken thigh"],false],["ing_0007_chicken_wing","chicken wing","cánh gà","chicken wing","protein_meat",21,["cánh gà tươi"],["canh ga","canh ga tuoi"],["chicken wings"],false],["ing_0008_chicken_drumstick","chicken drumstick","đùi tỏi gà","chicken drumstick","protein_meat",14,["tỏi gà","đùi gà tỏi"],["dui toi ga","toi ga","dui ga toi"],["chicken drumsticks"],false],["ing_0009_chicken_legs","chicken legs","đùi gà nguyên chiếc","chicken legs","protein_meat",16,["chân đùi gà","góc tư đùi gà"],["dui ga nguyen chiec","chan dui ga","goc tu dui ga"],["chicken leg"],false],["ing_0010_chicken_tenders","chicken tenders","thăn nội gà","chicken tenders","protein_meat",8,["phi lê gà non","thăn gà"],["than noi ga","phi le ga non","than ga"],["chicken tender","chicken tenderloin"],false],["ing_0011_chicken_livers","chicken livers","gan gà","chicken livers","protein_meat",8,["gan gà tươi"],["gan ga","gan ga tuoi"],["chicken liver"],false],["ing_0012_whole_chicken","whole chicken","gà nguyên con","whole chicken","protein_meat",35,["cả con gà","gà nguyên chiếc"],["ga nguyen con","ca con ga","ga nguyen chiec"],[],false],["ing_0013_cooked_chicken","cooked chicken","thịt gà chín","cooked chicken","protein_meat",23,["thịt gà luộc","gà xé","gà quay chín"],["thit ga chin","thit ga luoc","ga xe","ga quay chin"],["shredded cooked chicken"],false],["ing_0014_ground_chicken","ground chicken","thịt gà xay","ground chicken","protein_meat",19,["gà xay","thịt gà băm","gà băm"],["thit ga xay","ga xay","thit ga bam","ga bam"],["minced chicken"],false],["ing_0015_ground_beef","ground beef","thịt bò xay","ground beef","protein_meat",48,["bò xay","thịt bò băm","bò băm"],["thit bo xay","bo xay","thit bo bam","bo bam"],["minced beef"],true],["ing_0016_ground_beef_chuck","ground beef chuck","thịt nạc vai bò xay","ground beef chuck","protein_meat",31,["nạc vai bò xay","bò chuck xay"],["thit nac vai bo xay","nac vai bo xay","bo chuck xay"],["lean ground beef chuck"],false],["ing_0017_beef_chuck","beef chuck","thịt nạc vai bò","beef chuck","protein_meat",5,["nạc vai bò","bắp bò nạc vai","thịt bò hầm"],["thit nac vai bo","nac vai bo","bap bo nac vai","thit bo ham"],["chuck roast","beef chuck roast"],false],["ing_0018_boneless_beef_chuck","boneless beef chuck","thịt nạc vai bò rút xương","boneless beef chuck","protein_meat",9,["nạc vai bò không xương"],["thit nac vai bo rut xuong","nac vai bo khong xuong"],["boneless beef chuck roast"],false],["ing_0019_ground_sirloin","ground sirloin","thịt thăn ngoại bò xay","ground sirloin","protein_meat",9,["thăn bò xay","bò sirloin xay"],["thit than ngoai bo xay","than bo xay","bo sirloin xay"],[],false],["ing_0020_beef_tenderloin","beef tenderloin","thăn nội bò","beef tenderloin","protein_meat",8,["thăn bò","phi lê bò","thịt thăn bò"],["than noi bo","than bo","phi le bo","thit than bo"],["filet mignon","beef filet"],false],["ing_0021_flank_steak","flank steak","thăn bụng bò","flank steak","protein_meat",37,["thịt bò flank","thịt dẻ sườn bụng bò"],["than bung bo","thit bo flank","thit de suon bung bo"],["beef flank steak"],false],["ing_0022_skirt_steak","skirt steak","thịt diềm thăn bò","skirt steak","protein_meat",38,["diềm thăn bò","bò skirt steak"],["thit diem than bo","diem than bo","bo skirt steak"],["beef skirt steak"],false],["ing_0023_sirloin_steak","sirloin steak","thăn ngoại bò","sirloin steak","protein_meat",3,["bò bít tết sirloin","thịt thăn lưng bò"],["than ngoai bo","bo bit tet sirloin","thit than lung bo"],["top sirloin steak","beef sirloin"],false],["ing_0024_rib_eye_steak","rib-eye steak","thăn lưng bò ribeye","rib-eye steak","protein_meat",7,["bò ribeye","thịt bò mắt sườn"],["than lung bo ribeye","bo ribeye","thit bo mat suon"],["ribeye steak","rib eye steak"],false],["ing_0025_new_york_strip_steak","new york strip steak","thăn ngoại bò New York","new york strip steak","protein_meat",5,["bò strip steak","thăn bò New York"],["than ngoai bo new york","bo strip steak","than bo new york"],["strip steak"],false],["ing_0026_beef_brisket","beef brisket","ức bò","beef brisket","protein_meat",7,["gầu bò","thịt ức bò","nạm bò"],["uc bo","gau bo","thit uc bo","nam bo"],["flat-cut beef brisket"],false],["ing_0027_beef_short_ribs","beef short ribs","sườn non bò","beef short ribs","protein_meat",7,["sườn bò","sườn bò có xương"],["suon non bo","suon bo","suon bo co xuong"],["short ribs","bone-in beef short ribs"],false],["ing_0028_boneless_beef_short_ribs","boneless beef short ribs","sườn bò rút xương","boneless beef short ribs","protein_meat",8,["sườn non bò không xương"],["suon bo rut xuong","suon non bo khong xuong"],[],false],["ing_0029_corned_beef","corned beef","thịt bò muối","corned beef","protein_meat",4,["bò muối corned beef"],["thit bo muoi","bo muoi corned beef"],[],false],["ing_0030_ground_pork","ground pork","thịt heo xay","ground pork","protein_meat",76,["thịt heo băm","thịt lợn xay","thịt lợn băm","heo xay","heo băm","lợn xay","lợn băm","thịt băm","thịt xay"],["thit heo xay","thit heo bam","thit lon xay","thit lon bam","heo xay","heo bam","lon xay","lon bam","thit bam","thit xay"],["minced pork","heo xay"],false],["ing_0031_ground_pork_shoulder","ground pork shoulder","thịt nạc vai heo xay","ground pork shoulder","protein_meat",5,["nạc vai xay","thịt nạc vai xay","nạc vai lợn xay","nạc dăm xay","thịt nạc vai lợn xay"],["thit nac vai heo xay","nac vai xay","thit nac vai xay","nac vai lon xay","nac dam xay","thit nac vai lon xay"],[],false],["ing_0032_pork_belly","pork belly","thịt ba chỉ","pork belly","protein_meat",4,["thịt ba rọi","ba chỉ","ba rọi","thịt ba rọi heo","thịt ba chỉ lợn","ba chỉ heo"],["thit ba chi","thit ba roi","ba chi","ba roi","thit ba roi heo","thit ba chi lon","ba chi heo"],["skinless pork belly"],false],["ing_0033_pork_ribs","pork ribs","sườn heo","pork ribs","protein_meat",1,["sườn lợn","sườn non","thịt sườn","sườn heo non"],["suon heo","suon lon","suon non","thit suon","suon heo non"],["pork spareribs","baby back ribs"],false],["ing_0034_pork_tenderloin","pork tenderloin","thăn nội heo","pork tenderloin","protein_meat",21,["thăn heo","thăn lợn","thịt thăn heo"],["than noi heo","than heo","than lon","thit than heo"],["pork tenderloins"],false],["ing_0035_boneless_pork_loin","boneless pork loin","thăn lưng heo rút xương","boneless pork loin","protein_meat",10,["thăn lưng heo","thịt cốt lết không xương"],["than lung heo rut xuong","than lung heo","thit cot let khong xuong"],["pork loin","pork loin roast"],false],["ing_0036_pork_shoulder","pork shoulder","thịt nạc vai heo","pork shoulder","protein_meat",4,["nạc vai heo","nạc dăm heo","vai heo"],["thit nac vai heo","nac vai heo","nac dam heo","vai heo"],["pork butt","boston butt"],false],["ing_0037_boneless_pork_shoulder","boneless pork shoulder","nạc vai heo rút xương","boneless pork shoulder","protein_meat",29,["vai heo không xương"],["nac vai heo rut xuong","vai heo khong xuong"],["boneless pork butt"],false],["ing_0038_bone_in_pork_chops","bone-in pork chops","sườn cốt lết heo","bone-in pork chops","protein_meat",7,["cốt lết heo","thịt cốt lết","sườn cốt lết"],["suon cot let heo","cot let heo","thit cot let","suon cot let"],["pork chop","pork chops","bone-in pork chop","boneless pork loin chops"],false],["ing_0039_bacon","bacon","thịt xông khói","bacon","protein_meat",107,["ba rọi xông khói","thịt ba chỉ xông khói"],["thit xong khoi","ba roi xong khoi","thit ba chi xong khoi"],["bacon slices","sliced bacon"],false],["ing_0040_thick_cut_bacon","thick-cut bacon","thịt xông khói cắt dày","thick-cut bacon","protein_meat",39,["ba rọi xông khói lát dày"],["thit xong khoi cat day","ba roi xong khoi lat day"],["thick cut bacon"],false],["ing_0041_slab_bacon","slab bacon","thịt xông khói nguyên tảng","slab bacon","protein_meat",23,["ba rọi xông khói nguyên khối"],["thit xong khoi nguyen tang","ba roi xong khoi nguyen khoi"],[],false],["ing_0042_pancetta","pancetta","thịt ba chỉ muối Ý pancetta","pancetta","protein_meat",72,["thịt muối pancetta","ba rọi muối Ý"],["thit ba chi muoi y pancetta","thit muoi pancetta","ba roi muoi y"],[],false],["ing_0043_prosciutto","prosciutto","đùi heo muối Ý prosciutto","prosciutto","protein_meat",45,["thịt nguội prosciutto","giăm bông Ý"],["dui heo muoi y prosciutto","thit nguoi prosciutto","giam bong y"],["thinly sliced prosciutto"],false],["ing_0044_ham","ham","giăm bông","ham","protein_meat",11,["thịt nguội","thịt giăm bông","chả lụa Âu"],["giam bong","thit nguoi","thit giam bong","cha lua au"],[],true],["ing_0045_cooked_ham","cooked ham","giăm bông chín","cooked ham","protein_meat",8,["thịt nguội chín","giăm bông thái lát"],["giam bong chin","thit nguoi chin","giam bong thai lat"],["diced cooked ham"],false],["ing_0046_country_ham","country ham","giăm bông muối kiểu Mỹ","country ham","protein_meat",4,["đùi heo muối kiểu Mỹ"],["giam bong muoi kieu my","dui heo muoi kieu my"],[],false],["ing_0047_chinese_sausage","chinese sausage","lạp xưởng","chinese sausage","protein_meat",2,["cây lạp xưởng","lạp sườn"],["lap xuong","cay lap xuong","lap suon"],["lap xuong","chinese sausages"],false],["ing_0048_sweet_italian_sausage","sweet italian sausage","xúc xích Ý vị ngọt","sweet italian sausage","protein_meat",10,["xúc xích Ý","xúc xích heo kiểu Ý"],["xuc xich y vi ngot","xuc xich y","xuc xich heo kieu y"],["italian sausage","mild italian sausage"],false],["ing_0049_hot_italian_sausage","hot italian sausage","xúc xích Ý vị cay","hot italian sausage","protein_meat",1,["xúc xích Ý cay"],["xuc xich y vi cay","xuc xich y cay"],["spicy italian sausage"],false],["ing_0050_andouille_sausage","andouille sausage","xúc xích hun khói Andouille","andouille sausage","protein_meat",12,["xúc xích andouille"],["xuc xich hun khoi andouille","xuc xich andouille"],["andouille"],false],["ing_0051_chorizo","chorizo","xúc xích chorizo","chorizo","protein_meat",3,["xúc xích cay chorizo"],["xuc xich chorizo","xuc xich cay chorizo"],["mexican chorizo"],false],["ing_0052_spanish_chorizo","spanish chorizo","xúc xích khô Tây Ban Nha chorizo","spanish chorizo","protein_meat",9,["xúc xích chorizo Tây Ban Nha"],["xuc xich kho tay ban nha chorizo","xuc xich chorizo tay ban nha"],[],false],["ing_0053_ground_turkey","ground turkey","thịt gà tây xay","ground turkey","protein_meat",25,["gà tây xay","gà tây băm"],["thit ga tay xay","ga tay xay","ga tay bam"],["minced turkey"],false],["ing_0054_turkey","turkey","thịt gà tây","turkey","protein_meat",16,["gà tây"],["thit ga tay","ga tay"],["whole turkey"],false],["ing_0055_cooked_turkey","cooked turkey","thịt gà tây chín","cooked turkey","protein_meat",10,["gà tây quay chín"],["thit ga tay chin","ga tay quay chin"],[],false],["ing_0056_ground_lamb","ground lamb","thịt cừu xay","ground lamb","protein_meat",37,["cừu xay","thịt cừu băm"],["thit cuu xay","cuu xay","thit cuu bam"],["minced lamb"],false],["ing_0057_boneless_leg_of_lamb","boneless leg of lamb","đùi cừu rút xương","boneless leg of lamb","protein_meat",10,["thịt đùi cừu không xương"],["dui cuu rut xuong","thit dui cuu khong xuong"],["leg of lamb","bone-in leg of lamb"],false],["ing_0058_rib_lamb_chops","rib lamb chops","sườn cừu tảng","rib lamb chops","protein_meat",5,["sườn cừu","dẻ sườn cừu","đùi cừu hầm"],["suon cuu tang","suon cuu","de suon cuu","dui cuu ham"],["lamb rack","rack of lamb","racks of lamb","lamb chops","lamb shanks"],false],["ing_0059_boneless_lamb_shoulder","boneless lamb shoulder","thịt vai cừu","boneless lamb shoulder","protein_meat",6,["nạc vai cừu"],["thit vai cuu","nac vai cuu"],["lamb shoulder","bone-in lamb shoulder"],false],["ing_0060_duck","duck","thịt vịt","duck","protein_meat",1,["vịt","vịt nguyên con"],["thit vit","vit","vit nguyen con"],["whole duck"],false],["ing_0061_duck_breast","duck breast","ức vịt","duck breast","protein_meat",3,["thịt ức vịt","phi lê ức vịt"],["uc vit","thit uc vit","phi le uc vit"],["duck breasts","magret duck breast"],false],["ing_0062_duck_legs","duck legs","đùi vịt","duck legs","protein_meat",3,["thịt đùi vịt"],["dui vit","thit dui vit"],["duck leg"],false],["ing_0063_ground_veal","ground veal","thịt bê xay","ground veal","protein_meat",12,["bê xay","thịt bê băm"],["thit be xay","be xay","thit be bam"],["minced veal"],false],["ing_0064_shrimp","shrimp","tôm","shrimp","seafood",31,["tôm tươi","tôm bóc vỏ","tôm tươi bóc vỏ","tôm sú","tôm thẻ"],["tom","tom tuoi","tom boc vo","tom tuoi boc vo","tom su","tom the"],["shrimps","raw shrimp","uncooked shrimp","prawns","prawn"],true],["ing_0065_shrimp_peeled_deveined","shrimp peeled deveined","tôm bóc vỏ rút chỉ","shrimp peeled deveined","seafood",1,["tôm làm sạch bóc vỏ","tôm nõn làm sạch"],["tom boc vo rut chi","tom lam sach boc vo","tom non lam sach"],["shrimp, peeled, deveined","peeled and deveined shrimp","shrimp , peeled, deveined","uncooked shrimp, peeled, deveined"],false],["ing_0066_shrimp_in_shell","shrimp in shell","tôm nguyên vỏ","shrimp in shell","seafood",21,["tôm còn vỏ","tôm tươi nguyên vỏ"],["tom nguyen vo","tom con vo","tom tuoi nguyen vo"],["shell-on shrimp","unpeeled shrimp"],false],["ing_0067_jumbo_shrimp","jumbo shrimp","tôm cỡ lớn","jumbo shrimp","seafood",5,["tôm to","tôm sú lớn"],["tom co lon","tom to","tom su lon"],["large shrimp","extra-large shrimp"],false],["ing_0068_cooked_shrimp","cooked shrimp","tôm chín","cooked shrimp","seafood",12,["tôm luộc chín","tôm hấp chín"],["tom chin","tom luoc chin","tom hap chin"],[],false],["ing_0069_dried_shrimp","dried shrimp","tôm khô","dried shrimp","seafood",7,["tôm nõn khô"],["tom kho","tom non kho"],[],false],["ing_0070_squid","squid","mực","squid","seafood",4,["mực ống","mực tươi","mực lá"],["muc","muc ong","muc tuoi","muc la"],["calamari","cleaned squid"],false],["ing_0071_octopus","octopus","bạch tuộc","octopus","seafood",1,["bạch tuộc tươi"],["bach tuoc","bach tuoc tuoi"],["baby octopus"],false],["ing_0072_salmon","salmon","cá hồi","salmon","seafood",2,["cá hồi tươi","thịt cá hồi"],["ca hoi","ca hoi tuoi","thit ca hoi"],["fresh salmon"],false],["ing_0073_salmon_fillet","salmon fillet","phi lê cá hồi","salmon fillet","seafood",16,["cá hồi phi lê","miếng cá hồi phi lê"],["phi le ca hoi","ca hoi phi le","mieng ca hoi phi le"],["salmon fillets"],false],["ing_0074_skinless_salmon_fillet","skinless salmon fillet","phi lê cá hồi bỏ da","skinless salmon fillet","seafood",24,["cá hồi phi lê không da"],["phi le ca hoi bo da","ca hoi phi le khong da"],["skinless salmon fillets"],false],["ing_0075_smoked_salmon","smoked salmon","cá hồi xông khói","smoked salmon","seafood",36,["cá hồi hun khói"],["ca hoi xong khoi","ca hoi hun khoi"],["thinly sliced smoked salmon"],false],["ing_0076_cod_fillet","cod fillet","cá tuyết","cod fillet","seafood",6,["cá tuyết tươi","phi lê cá tuyết"],["ca tuyet","ca tuyet tuoi","phi le ca tuyet"],["cod","cod fillets","skinless cod fillet","black cod fillet with skin"],false],["ing_0077_halibut_fillet","halibut fillet","phi lê cá bơn halibut","halibut fillet","seafood",14,["cá bơn","phi lê cá bơn"],["phi le ca bon halibut","ca bon","phi le ca bon"],["halibut","halibut fillets"],false],["ing_0078_sea_bass_fillet_with_skin","sea bass fillet with skin","cá vược biển (cá chẽm)","sea bass fillet with skin","seafood",2,["cá chẽm","cá vược","phi lê cá chẽm"],["ca vuoc bien (ca chem)","ca chem","ca vuoc","phi le ca chem"],["sea bass","black sea bass","striped bass"],false],["ing_0079_smoked_trout","smoked trout","cá hồi vân trout","smoked trout","seafood",5,["cá hồi suối","phi lê cá trout","cá trout xông khói"],["ca hoi van trout","ca hoi suoi","phi le ca trout","ca trout xong khoi"],["trout","rainbow trout"],false],["ing_0080_tuna_steak","tuna steak","cá ngừ tươi","tuna steak","seafood",5,["cá ngừ","phi lê cá ngừ"],["ca ngu tuoi","ca ngu","phi le ca ngu"],["tuna","ahi tuna","ahi tuna steak","tuna steaks","yellowfin tuna"],false],["ing_0081_tuna_in_olive_oil","tuna in olive oil","cá ngừ đóng hộp","tuna in olive oil","seafood",5,["cá ngừ ngâm dầu","cá ngừ hộp"],["ca ngu dong hop","ca ngu ngam dau","ca ngu hop"],["canned tuna","oil-packed tuna"],false],["ing_0082_swordfish_steak","swordfish steak","cá kiếm cắt lát","swordfish steak","seafood",6,["cá kiếm","phi lê cá kiếm"],["ca kiem cat lat","ca kiem","phi le ca kiem"],["swordfish","swordfish steaks"],false],["ing_0083_snapper_fillet","snapper fillet","cá hồng","snapper fillet","seafood",4,["cá hồng biển","phi lê cá hồng"],["ca hong","ca hong bien","phi le ca hong"],["snapper","red snapper","red snapper fillet"],false],["ing_0084_catfish_fillet","catfish fillet","phi lê cá da trơn","catfish fillet","seafood",1,["cá trê phi lê","cá basa phi lê","cá tra phi lê","cá da trơn"],["phi le ca da tron","ca tre phi le","ca basa phi le","ca tra phi le","ca da tron"],["catfish","catfish fillets"],false],["ing_0085_tilapia_fillet","tilapia fillet","phi lê cá rô phi","tilapia fillet","seafood",3,["cá rô phi","cá điêu hồng phi lê"],["phi le ca ro phi","ca ro phi","ca dieu hong phi le"],["tilapia","tilapia fillets"],false],["ing_0086_sardine","sardine","cá trích / cá mòi","sardine","seafood",1,["cá mòi","cá trích tươi"],["ca trich / ca moi","ca moi","ca trich tuoi"],["fresh sardines","sardines"],false],["ing_0087_anchovy_fillet","anchovy fillet","phi lê cá cơm muối","anchovy fillet","seafood",49,["cá cơm anchovy","cá cơm ngâm dầu","cá cơm muối"],["phi le ca com muoi","ca com anchovy","ca com ngam dau","ca com muoi"],["anchovy","anchovies","anchovy fillets","oil-packed anchovy fillet"],false],["ing_0088_anchovy_paste","anchovy paste","sốt cá cơm nghiền","anchovy paste","seafood",23,["mắm cá cơm nghiền","bột nhão cá cơm"],["sot ca com nghien","mam ca com nghien","bot nhao ca com"],[],false],["ing_0089_sea_scallop","sea scallop","sò điệp","sea scallop","seafood",19,["cồi sò điệp","sò điệp biển","sò điệp tươi"],["so diep","coi so diep","so diep bien","so diep tuoi"],["scallop","scallops","sea scallops","bay scallops"],false],["ing_0090_littleneck_clam","littleneck clam","ngêu / nghêu","littleneck clam","seafood",25,["ngêu","nghêu","ngao","nghêu tươi"],["ngeu / ngheu","ngeu","ngheu","ngao","ngheu tuoi"],["clam","clams","littleneck clams","manila clams"],false],["ing_0091_mussel","mussel","vẹm biển","mussel","seafood",10,["vẹm","con vẹm","vẹm xanh"],["vem bien","vem","con vem","vem xanh"],["mussels","cultivated mussel"],false],["ing_0092_oyster","oyster","hàu","oyster","seafood",3,["hàu tươi","ruột hàu","con hàu"],["hau","hau tuoi","ruot hau","con hau"],["oysters","shucked oysters"],false],["ing_0093_lump_crabmeat","lump crabmeat","thịt cua bóc sẵn","lump crabmeat","seafood",11,["thịt cua","thịt ghẹ","cua bóc thịt"],["thit cua boc san","thit cua","thit ghe","cua boc thit"],["crabmeat","crab meat","jumbo lump crabmeat","crab"],false],["ing_0094_live_lobster","live lobster","tôm hùm","live lobster","seafood",22,["tôm hùm tươi","thịt tôm hùm"],["tom hum","tom hum tuoi","thit tom hum"],["lobster","lobster tails"],false],["ing_0095_egg","egg","trứng","egg","egg_tofu",2416,["trứng gà","quả trứng","quả trứng gà","trứng tươi"],["trung","trung ga","qua trung","qua trung ga","trung tuoi"],["eggs","whole egg","large egg"],true],["ing_0096_egg_yolk","egg yolk","lòng đỏ trứng","egg yolk","egg_tofu",647,["lòng đỏ trứng gà"],["long do trung","long do trung ga"],["egg yolks"],false],["ing_0097_egg_white","egg white","lòng trắng trứng","egg white","egg_tofu",390,["lòng trắng trứng gà"],["long trang trung","long trang trung ga"],["egg whites"],false],["ing_0098_hard_boiled_egg","hard-boiled egg","trứng luộc chín","hard-boiled egg","egg_tofu",61,["trứng gà luộc"],["trung luoc chin","trung ga luoc"],["hard boiled egg","hard-boiled eggs"],false],["ing_0099_quail_egg","quail egg","trứng cút","quail egg","egg_tofu",2,["quả trứng cút","trứng chim cút"],["trung cut","qua trung cut","trung chim cut"],["quail eggs"],false],["ing_0100_firm_tofu","firm tofu","đậu phụ cứng","firm tofu","egg_tofu",14,["đậu hũ cứng","đậu phụ chắc","đậu khuôn"],["dau phu cung","dau hu cung","dau phu chac","dau khuon"],["firm bean curd"],false],["ing_0101_extra_firm_tofu","extra-firm tofu","đậu phụ ép chắc","extra-firm tofu","egg_tofu",13,["đậu hũ ép chắc","đậu phụ chiên"],["dau phu ep chac","dau hu ep chac","dau phu chien"],["extra firm tofu"],false],["ing_0102_silken_tofu","silken tofu","đậu hũ non","silken tofu","egg_tofu",9,["đậu phụ non","đậu phụ lụa","tàu hũ non"],["dau hu non","dau phu non","dau phu lua","tau hu non"],["soft tofu"],false],["ing_0103_tomato","tomato","cà chua","tomato","vegetables",323,["quả cà chua","trái cà chua","cà chua tươi"],["ca chua","qua ca chua","trai ca chua","ca chua tuoi"],["tomatoes","ripe tomato","whole tomato"],true],["ing_0104_cherry_tomato","cherry tomato","cà chua bi","cherry tomato","vegetables",180,["cà chua cherry","quả cà chua bi"],["ca chua bi","ca chua cherry","qua ca chua bi"],["cherry tomatoes"],false],["ing_0105_grape_tomato","grape tomato","cà chua bi dài","grape tomato","vegetables",38,["cà chua nho"],["ca chua bi dai","ca chua nho"],["grape tomatoes"],false],["ing_0106_plum_tomato","plum tomato","cà chua múi","plum tomato","vegetables",118,["cà chua plum","cà chua roma"],["ca chua mui","ca chua plum","ca chua roma"],["plum tomatoes","roma tomato","roma tomatoes"],false],["ing_0107_heirloom_tomato","heirloom tomato","cà chua cổ điển nhiều màu","heirloom tomato","vegetables",35,["cà chua heirloom"],["ca chua co dien nhieu mau","ca chua heirloom"],["heirloom tomatoes"],false],["ing_0108_beefsteak_tomato","beefsteak tomato","cà chua quả lớn beefsteak","beefsteak tomato","vegetables",18,["cà chua to cắt lát"],["ca chua qua lon beefsteak","ca chua to cat lat"],["beefsteak tomatoes"],false],["ing_0109_tomato_in_juice","tomato in juice","cà chua đóng hộp nguyên quả","tomato in juice","vegetables",43,["cà chua hộp ngâm nước ép"],["ca chua dong hop nguyen qua","ca chua hop ngam nuoc ep"],["whole tomato in juice","canned whole tomatoes"],false],["ing_0110_onion","onion","hành tây","onion","vegetables",1490,["củ hành tây"],["hanh tay","cu hanh tay"],["onions"],true],["ing_0111_red_onion","red onion","hành tây tím","red onion","vegetables",568,["hành tây đỏ","củ hành tây tím"],["hanh tay tim","hanh tay do","cu hanh tay tim"],["red onions"],false],["ing_0112_white_onion","white onion","hành tây trắng","white onion","vegetables",185,["củ hành tây trắng"],["hanh tay trang","cu hanh tay trang"],["white onions"],false],["ing_0113_yellow_onion","yellow onion","hành tây vàng","yellow onion","vegetables",166,["củ hành tây vàng"],["hanh tay vang","cu hanh tay vang"],["yellow onions"],false],["ing_0114_sweet_onion","sweet onion","hành tây ngọt","sweet onion","vegetables",47,["hành tây vidalia"],["hanh tay ngot","hanh tay vidalia"],["vidalia onion"],false],["ing_0115_pearl_onion","pearl onion","hành tây bi","pearl onion","vegetables",19,["củ hành bi"],["hanh tay bi","cu hanh bi"],["pearl onions"],false],["ing_0116_pickled_red_onion","pickled red onion","hành tây tím ngâm chua","pickled red onion","vegetables",9,["hành tím muối chua"],["hanh tay tim ngam chua","hanh tim muoi chua"],[],false],["ing_0117_leek","leek","tỏi tây","leek","vegetables",136,["hành boa-rô","boa rô","cây tỏi tây","hành baro"],["toi tay","hanh boa-ro","boa ro","cay toi tay","hanh baro"],["leeks"],false],["ing_0118_carrot","carrot","cà rốt","carrot","vegetables",638,["củ cà rốt"],["ca rot","cu ca rot"],["carrots"],true],["ing_0119_baby_carrot","baby carrot","cà rốt bao tử","baby carrot","vegetables",13,["cà rốt non","cà rốt baby"],["ca rot bao tu","ca rot non","ca rot baby"],["baby carrots"],false],["ing_0120_potato","potato","khoai tây","potato","vegetables",25,["củ khoai tây"],["khoai tay","cu khoai tay"],["potatoes"],true],["ing_0121_russet_potato","russet potato","khoai tây Russet","russet potato","vegetables",128,["khoai tây vỏ nâu bở"],["khoai tay russet","khoai tay vo nau bo"],["russet potatoes","baking potato"],false],["ing_0122_yukon_gold_potato","yukon gold potato","khoai tây Yukon Gold","yukon gold potato","vegetables",122,["khoai tây vàng Yukon","khoai tây vàng"],["khoai tay yukon gold","khoai tay vang yukon","khoai tay vang"],["yukon gold potatoes","baby yukon gold potato"],false],["ing_0123_red_potato","red potato","khoai tây vỏ đỏ","red potato","vegetables",20,["khoai tây đỏ"],["khoai tay vo do","khoai tay do"],["red potatoes","red-skinned potato","boiling potato"],false],["ing_0124_waxy_potato","waxy potato","khoai tây ít bở","waxy potato","vegetables",9,["khoai tây dẻo ít bở","khoai tây sáp"],["khoai tay it bo","khoai tay deo it bo","khoai tay sap"],["new potato","fingerling potato"],false],["ing_0125_sweet_potato","sweet potato","khoai lang","sweet potato","vegetables",109,["củ khoai lang","khoai lang sống","khoai lang mật"],["khoai lang","cu khoai lang","khoai lang song","khoai lang mat"],["sweet potatoes","red-skinned sweet potato"],true],["ing_0126_mushroom","mushroom","nấm","mushroom","vegetables",42,["nấm tươi","nấm mỡ"],["nam","nam tuoi","nam mo"],["mushrooms","white mushroom"],true],["ing_0127_button_mushroom","button mushroom","nấm mỡ trắng","button mushroom","vegetables",24,["nấm nút","nấm trắng tròn"],["nam mo trang","nam nut","nam trang tron"],["button mushrooms"],false],["ing_0128_crimini_mushroom","crimini mushroom","nấm mỡ nâu","crimini mushroom","vegetables",43,["nấm crimini","nấm cremini"],["nam mo nau","nam crimini","nam cremini"],["cremini mushroom","crimini mushrooms","cremini mushrooms"],false],["ing_0129_shiitake_mushroom","shiitake mushroom","nấm hương","shiitake mushroom","vegetables",49,["nấm đông cô","nấm hương tươi","nấm đông cô tươi","nấm shiitake"],["nam huong","nam dong co","nam huong tuoi","nam dong co tuoi","nam shiitake"],["shiitake mushrooms","fresh shiitake mushrooms"],false],["ing_0130_portobello_mushroom","portobello mushroom","nấm portobello cỡ lớn","portobello mushroom","vegetables",13,["nấm portobello"],["nam portobello co lon","nam portobello"],["portobello mushrooms","portabella mushroom"],false],["ing_0131_dried_porcini_mushroom","dried porcini mushroom","nấm thông khô porcini","dried porcini mushroom","vegetables",45,["nấm porcini khô"],["nam thong kho porcini","nam porcini kho"],["dried porcini"],false],["ing_0132_dried_wood_ear_mushroom","dried wood ear mushroom","nấm mèo","dried wood ear mushroom","vegetables",4,["mộc nhĩ","nấm mèo khô","mộc nhĩ khô","tai nấm mèo khô"],["nam meo","moc nhi","nam meo kho","moc nhi kho","tai nam meo kho"],["wood ear mushroom","black fungus"],false],["ing_0133_mixed_mushroom","mixed mushroom","nấm tổng hợp","mixed mushroom","vegetables",12,["các loại nấm rừng","nấm hỗn hợp"],["nam tong hop","cac loai nam rung","nam hon hop"],["wild mushroom","assorted wild mushroom","mixed wild mushroom"],false],["ing_0134_spinach","spinach","rau chân vịt","spinach","vegetables",26,["cải bó xôi","rau bina"],["rau chan vit","cai bo xoi","rau bina"],["spinach leaf","spinach leaves","fresh spinach","rau bina"],true],["ing_0135_baby_spinach","baby spinach","rau chân vịt non","baby spinach","vegetables",84,["cải bó xôi non","rau bina baby"],["rau chan vit non","cai bo xoi non","rau bina baby"],["baby spinach leaf","baby spinach leaves"],false],["ing_0136_frozen_spinach","frozen spinach","rau chân vịt đông lạnh","frozen spinach","vegetables",22,["cải bó xôi đông lạnh"],["rau chan vit dong lanh","cai bo xoi dong lanh"],[],false],["ing_0137_broccoli","broccoli","bông cải xanh","broccoli","vegetables",22,["súp lơ xanh","cây bông cải xanh"],["bong cai xanh","sup lo xanh","cay bong cai xanh"],["broccoli floret","broccoli florets"],false],["ing_0138_broccolini","broccolini","bông cải xanh thân dài","broccolini","vegetables",19,["súp lơ xanh baby","cải rổ bông"],["bong cai xanh than dai","sup lo xanh baby","cai ro bong"],[],false],["ing_0139_broccoli_rabe","broccoli rabe","cải ngồng Ý broccoli rabe","broccoli rabe","vegetables",12,["cải ngồng đắng"],["cai ngong y broccoli rabe","cai ngong dang"],["rapini"],false],["ing_0140_cauliflower","cauliflower","bông cải trắng","cauliflower","vegetables",69,["súp lơ trắng","cây súp lơ trắng"],["bong cai trang","sup lo trang","cay sup lo trang"],["cauliflower floret","cauliflower florets"],false],["ing_0141_cabbage","cabbage","bắp cải","cabbage","vegetables",19,["cải bắp","bắp cải trắng"],["bap cai","cai bap","bap cai trang"],["green cabbage"],false],["ing_0142_red_cabbage","red cabbage","bắp cải tím","red cabbage","vegetables",32,["cải bắp tím","bắp cải đỏ"],["bap cai tim","cai bap tim","bap cai do"],["purple cabbage"],false],["ing_0143_napa_cabbage","napa cabbage","cải thảo","napa cabbage","vegetables",33,["bắp cải thảo","rau cải thảo"],["cai thao","bap cai thao","rau cai thao"],["chinese cabbage"],false],["ing_0144_savoy_cabbage","savoy cabbage","bắp cải xoăn Savoy","savoy cabbage","vegetables",22,["bắp cải nhăn"],["bap cai xoan savoy","bap cai nhan"],[],false],["ing_0145_bok_choy","bok choy","cải thìa","bok choy","vegetables",8,["rau cải thìa","cải chíp"],["cai thia","rau cai thia","cai chip"],["pak choi"],false],["ing_0146_baby_bok_choy","baby bok choy","cải thìa non","baby bok choy","vegetables",25,["cải chíp non","cải thìa baby"],["cai thia non","cai chip non","cai thia baby"],["anghai bok choy"],false],["ing_0147_choy_sum","choy sum","cải ngọt","choy sum","vegetables",1,["rau cải ngọt"],["cai ngot","rau cai ngot"],["yu choy"],false],["ing_0148_kale","kale","cải xoăn kale","kale","vegetables",23,["rau cải xoăn","cải kale"],["cai xoan kale","rau cai xoan","cai kale"],["tuscan kale","lacinato kale","curly kale"],false],["ing_0149_swiss_chard","swiss chard","cải cầu vồng","swiss chard","vegetables",17,["rau cải cầu vồng","cải thụy sĩ"],["cai cau vong","rau cai cau vong","cai thuy si"],["chard","rainbow chard"],false],["ing_0150_collard_greens","collard greens","cải rổ","collard greens","vegetables",6,["rau cải rổ","lá cải rổ"],["cai ro","rau cai ro","la cai ro"],["collards"],false],["ing_0151_watercress","watercress","cải xoong","watercress","vegetables",35,["rau cải xoong"],["cai xoong","rau cai xoong"],["watercress sprig"],false],["ing_0152_arugula","arugula","rau cải tên lửa arugula","arugula","vegetables",76,["xà lách rocket","rau rocket"],["rau cai ten lua arugula","xa lach rocket","rau rocket"],["baby arugula","arugula leaf"],false],["ing_0153_romaine_lettuce","romaine lettuce","xà lách romaine","romaine lettuce","vegetables",19,["xà lách lô lô","rau xà lách","xà lách"],["xa lach romaine","xa lach lo lo","rau xa lach","xa lach"],["romaine","romaine heart","lettuce","lettuce leaf"],false],["ing_0154_iceberg_lettuce","iceberg lettuce","xà lách giòn iceberg","iceberg lettuce","vegetables",22,["xà lách búp Mỹ","xà lách cuộn"],["xa lach gion iceberg","xa lach bup my","xa lach cuon"],[],false],["ing_0155_butter_lettuce","butter lettuce","xà lách mỡ","butter lettuce","vegetables",10,["xà lách bơ","xà lách bibb"],["xa lach mo","xa lach bo","xa lach bibb"],["bibb lettuce","boston lettuce"],false],["ing_0156_radicchio","radicchio","xà lách tím radicchio","radicchio","vegetables",37,["rau diếp tím Ý"],["xa lach tim radicchio","rau diep tim y"],[],false],["ing_0157_belgian_endive","belgian endive","rau diếp xoăn endive","belgian endive","vegetables",12,["xà lách endive","cải cúc đắng Âu"],["rau diep xoan endive","xa lach endive","cai cuc dang au"],["endive","belgian endives","endives","escarole","frisée"],false],["ing_0158_cucumber","cucumber","dưa leo","cucumber","vegetables",61,["dưa chuột","trái dưa leo","quả dưa chuột"],["dua leo","dua chuot","trai dua leo","qua dua chuot"],["cucumbers"],false],["ing_0159_seedless_cucumber","seedless cucumber","dưa leo không hạt","seedless cucumber","vegetables",25,["dưa chuột không hạt"],["dua leo khong hat","dua chuot khong hat"],["english hothouse cucumber","english cucumber"],false],["ing_0160_persian_cucumber","persian cucumber","dưa leo baby Ba Tư","persian cucumber","vegetables",60,["dưa chuột bao tử","dưa leo mini"],["dua leo baby ba tu","dua chuot bao tu","dua leo mini"],["persian cucumbers","kirby cucumber"],false],["ing_0161_zucchini","zucchini","bí ngòi xanh","zucchini","vegetables",160,["bí ngòi","quả bí ngòi"],["bi ngoi xanh","bi ngoi","qua bi ngoi"],["courgette"],false],["ing_0162_yellow_squash","yellow squash","bí ngòi vàng","yellow squash","vegetables",10,["bí mùa hè vàng"],["bi ngoi vang","bi mua he vang"],["summer squash"],false],["ing_0163_butternut_squash","butternut squash","bí đỏ hồ lô","butternut squash","vegetables",56,["bí butternut","bí hồ lô"],["bi do ho lo","bi butternut","bi ho lo"],["cubes butternut squash"],false],["ing_0164_acorn_squash","acorn squash","bí đỏ acorn","acorn squash","vegetables",8,["bí sồi"],["bi do acorn","bi soi"],["delicata squash"],false],["ing_0165_pumpkin","pumpkin","bí đỏ","pumpkin","vegetables",4,["bí ngô","quả bí đỏ","trái bí đỏ"],["bi do","bi ngo","qua bi do","trai bi do"],["fresh pumpkin"],false],["ing_0166_canned_pure_pumpkin","canned pure pumpkin","bí đỏ nghiền đóng hộp","canned pure pumpkin","vegetables",19,["bí ngô nghiền","sốt bí đỏ nguyên chất"],["bi do nghien dong hop","bi ngo nghien","sot bi do nguyen chat"],["pure pumpkin","pumpkin purée","canned solid-pack pumpkin"],false],["ing_0167_eggplant","eggplant","cà tím","eggplant","vegetables",73,["quả cà tím","trái cà tím"],["ca tim","qua ca tim","trai ca tim"],["eggplants","aubergine","italian eggplant","japanese eggplant"],false],["ing_0168_bell_pepper","bell_pepper","ớt chuông","bell pepper","vegetables",27,["quả ớt chuông","ớt ngọt"],["ot chuong","qua ot chuong","ot ngot"],["bell peppers"],false],["ing_0169_red_bell_pepper","red bell pepper","ớt chuông đỏ","red bell pepper","vegetables",248,["quả ớt chuông đỏ"],["ot chuong do","qua ot chuong do"],["red bell peppers"],false],["ing_0170_green_bell_pepper","green bell pepper","ớt chuông xanh","green bell pepper","vegetables",91,["quả ớt chuông xanh"],["ot chuong xanh","qua ot chuong xanh"],["green bell peppers"],false],["ing_0171_yellow_bell_pepper","yellow bell pepper","ớt chuông vàng","yellow bell pepper","vegetables",43,["quả ớt chuông vàng"],["ot chuong vang","qua ot chuong vang"],["yellow bell peppers"],false],["ing_0172_orange_bell_pepper","orange bell pepper","ớt chuông cam","orange bell pepper","vegetables",8,["quả ớt chuông cam"],["ot chuong cam","qua ot chuong cam"],["orange bell peppers"],false],["ing_0173_roasted_red_bell_pepper","roasted red bell_pepper","ớt chuông đỏ nướng","roasted red bell pepper","vegetables",7,["ớt chuông đỏ nướng đóng lọ"],["ot chuong do nuong","ot chuong do nuong dong lo"],["roasted red peppers"],false],["ing_0174_green_bean","green bean","đậu cô ve","green bean","vegetables",86,["đậu que","quả đậu que","đậu cô ve xanh"],["dau co ve","dau que","qua dau que","dau co ve xanh"],["green_beans","green beans","haricots verts","string beans"],true],["ing_0175_pea","pea","đậu hà lan","pea","vegetables",11,["hạt đậu hà lan","đậu hà lan tươi"],["dau ha lan","hat dau ha lan","dau ha lan tuoi"],["peas","green peas","English peas"],false],["ing_0176_frozen_pea","frozen pea","đậu hà lan đông lạnh","frozen pea","vegetables",56,["hạt đậu hà lan đông lạnh"],["dau ha lan dong lanh","hat dau ha lan dong lanh"],["frozen peas","frozen petite peas"],false],["ing_0177_sugar_snap_pea","sugar snap pea","đậu hà lan giòn ngọt","sugar snap pea","vegetables",40,["đậu hà lan ăn cả vỏ","đậu snap pea"],["dau ha lan gion ngot","dau ha lan an ca vo","dau snap pea"],["sugar snap peas","snap peas"],false],["ing_0178_snow_pea","snow pea","đậu tuyết","snow pea","vegetables",24,["đậu hà lan dẹt","đậu ván tuyết"],["dau tuyet","dau ha lan det","dau van tuyet"],["snow peas","chinese pea pods"],false],["ing_0179_bean_sprouts","bean sprouts","giá đỗ","bean sprouts","vegetables",14,["giá","giá đậu xanh"],["gia do","gia","gia dau xanh"],["mung bean sprouts","bean sprout"],false],["ing_0180_okra","okra","đậu bắp","okra","vegetables",9,["quả đậu bắp","trái đậu bắp"],["dau bap","qua dau bap","trai dau bap"],["fresh okra"],false],["ing_0181_corn","corn","ngô","corn","vegetables",23,["bắp","bắp ngô","ngô ngọt","bắp mỹ"],["bap","bap ngo","ngo ngot","bap my"],["ear of corn","ears of corn","sweet corn","ears corn"],true],["ing_0182_corn_kernels","corn kernels","hạt ngô ngọt","corn kernels","vegetables",46,["hạt bắp","ngô tách hạt"],["hat ngo ngot","hat bap","ngo tach hat"],["fresh corn kernels"],false],["ing_0183_frozen_corn","frozen corn","ngô ngọt đông lạnh","frozen corn","vegetables",8,["hạt bắp đông lạnh"],["ngo ngot dong lanh","hat bap dong lanh"],["frozen corn kernels"],false],["ing_0184_asparagus","asparagus","măng tây","asparagus","vegetables",85,["măng tây xanh","cọng măng tây"],["mang tay","mang tay xanh","cong mang tay"],["asparagus spears"],false],["ing_0185_celery","celery","cần tây","celery","vegetables",181,["rau cần tây"],["can tay","rau can tay"],["celery ribs","celery rib"],false],["ing_0186_celery_stalk","celery stalk","cọng cần tây","celery stalk","vegetables",246,["nhánh cần tây","thân cần tây"],["cong can tay","nhanh can tay","than can tay"],["celery stalks"],false],["ing_0187_celery_root","celery root","củ cần tây","celery root","vegetables",30,["cần tây củ","củ celeriac"],["cu can tay","can tay cu","cu celeriac"],["celeriac"],false],["ing_0188_fennel_bulb","fennel bulb","củ tiểu hồi","fennel bulb","vegetables",116,["củ thì là Tây","bẹ tiểu hồi"],["cu tieu hoi","cu thi la tay","be tieu hoi"],["fennel","fennel bulbs"],false],["ing_0189_radish","radish","củ cải đỏ tròn","radish","vegetables",116,["củ cải đường nhỏ","củ cải đỏ"],["cu cai do tron","cu cai duong nho","cu cai do"],["radishes","red radish"],false],["ing_0190_daikon","daikon","củ cải trắng","daikon","vegetables",15,["củ cải","củ cải trắng Nhật"],["cu cai trang","cu cai","cu cai trang nhat"],["daikon radish"],false],["ing_0191_turnip","turnip","củ cải turnip","turnip","vegetables",31,["củ cải trắng tròn Âu"],["cu cai turnip","cu cai trang tron au"],["turnips","baby turnip"],false],["ing_0192_beet","beet","củ dền","beet","vegetables",41,["củ dền đỏ","củ cải dền"],["cu den","cu den do","cu cai den"],["beets","red beet","beetroot"],false],["ing_0193_parsnips","parsnips","củ cải vàng parsnip","parsnips","vegetables",52,["cà rốt trắng","củ parsnip"],["cu cai vang parsnip","ca rot trang","cu parsnip"],["parsnip"],false],["ing_0194_brussels_sprouts","brussels sprouts","bắp cải tí hon Brussels","brussels sprouts","vegetables",59,["bắp cải mini","cải bi Brussels"],["bap cai ti hon brussels","bap cai mini","cai bi brussels"],["brussels sprout"],false],["ing_0195_artichokes","artichokes","hoa atisô","artichokes","vegetables",14,["atisô","bông atisô"],["hoa atiso","atiso","bong atiso"],["artichoke","baby artichokes","artichoke heart","marinated artichoke heart"],false],["ing_0196_garlic","garlic","tỏi","garlic","herbs_aromatics",3664,["củ tỏi","tép tỏi","tỏi băm","tỏi băm nhỏ","tỏi tươi"],["toi","cu toi","tep toi","toi bam","toi bam nho","toi tuoi"],["garlic clove","garlic cloves","cloves garlic"],false],["ing_0197_shallot","shallot","hành tím","shallot","herbs_aromatics",963,["hành khô","củ hành tím","củ hành khô","hành ta"],["hanh tim","hanh kho","cu hanh tim","cu hanh kho","hanh ta"],["shallots"],false],["ing_0198_green_onion","green_onion","hành lá","green onion","herbs_aromatics",815,["nhánh hành lá","cọng hành lá","hành hoa"],["hanh la","nhanh hanh la","cong hanh la","hanh hoa"],["green onions","scallion","scallions","spring onion","spring onions"],false],["ing_0199_chives","chives","hẹ Tây","chives","herbs_aromatics",442,["lá hẹ","hẹ","cọng hẹ"],["he tay","la he","he","cong he"],["fresh chives"],false],["ing_0200_ginger","ginger","gừng","ginger","herbs_aromatics",725,["củ gừng","nhánh gừng","nhánh gừng nhỏ","gừng tươi","gừng băm","gừng nhỏ"],["gung","cu gung","nhanh gung","nhanh gung nho","gung tuoi","gung bam","gung nho"],["fresh ginger","peeled fresh ginger"],false],["ing_0201_lemongrass","lemongrass","sả","lemongrass","herbs_aromatics",24,["cây sả","củ sả","sả băm","sả cây"],["sa","cay sa","cu sa","sa bam","sa cay"],["lemongrass stalks"],false],["ing_0202_turmeric","turmeric","nghệ tươi","turmeric","herbs_aromatics",62,["củ nghệ","nghệ"],["nghe tuoi","cu nghe","nghe"],["fresh turmeric"],false],["ing_0203_cilantro","cilantro","ngò rí","cilantro","herbs_aromatics",568,["rau mùi","ngò","rau ngò","mùi ta"],["ngo ri","rau mui","rau ngo","mui ta"],["cilantro leaf","fresh cilantro","coriander leaves"],false],["ing_0204_parsley","parsley","mùi tây","parsley","herbs_aromatics",400,["rau mùi tây","ngò tây"],["mui tay","rau mui tay","ngo tay"],["parsley leaf","fresh parsley"],false],["ing_0205_flat_leaf_parsley","flat-leaf parsley","mùi tây lá phẳng","flat-leaf parsley","herbs_aromatics",408,["ngò tây lá phẳng","mùi tây Ý"],["mui tay la phang","ngo tay la phang","mui tay y"],["italian parsley","flat-leaf parsley leaf","italian parsley leaf"],false],["ing_0206_basil","basil","húng quế / húng tây","basil","herbs_aromatics",237,["rau húng quế","lá húng tây","húng tây","húng quế"],["hung que / hung tay","rau hung que","la hung tay","hung tay","hung que"],["basil leaf","fresh basil","thai basil"],false],["ing_0207_packaged_basil_leaf","packaged basil leaf","lá húng tây đóng gói","packaged basil leaf","herbs_aromatics",1,["húng tây tươi đóng gói"],["la hung tay dong goi","hung tay tuoi dong goi"],[],false],["ing_0208_mint","mint","bạc hà / húng lủi","mint","herbs_aromatics",248,["lá bạc hà","rau húng lủi","húng lủi","bạc hà tươi"],["bac ha / hung lui","la bac ha","rau hung lui","hung lui","bac ha tuoi"],["mint leaf","fresh mint"],false],["ing_0209_mint_leaf_plus_sprig","mint leaf plus sprig","lá bạc hà và một nhánh để trang trí","mint leaf plus sprig","herbs_aromatics",2,[],["la bac ha va mot nhanh de trang tri"],[],false],["ing_0210_dill","dill","thì là","dill","herbs_aromatics",221,["rau thì là","lá thì là"],["thi la","rau thi la","la thi la"],["fresh dill","dill sprigs"],false],["ing_0211_rosemary","rosemary","hương thảo","rosemary","herbs_aromatics",351,["lá hương thảo","nhánh hương thảo"],["huong thao","la huong thao","nhanh huong thao"],["rosemary leaf","fresh rosemary"],false],["ing_0212_thyme","thyme","cỏ xạ hương thyme","thyme","herbs_aromatics",551,["lá xạ hương","xạ hương tươi"],["co xa huong thyme","la xa huong","xa huong tuoi"],["thyme leaf","fresh thyme"],false],["ing_0213_oregano","oregano","kinh giới cay oregano","oregano","herbs_aromatics",152,["lá oregano tươi"],["kinh gioi cay oregano","la oregano tuoi"],["oregano leaf","fresh oregano"],false],["ing_0214_sage","sage","lá xô thơm sage","sage","herbs_aromatics",145,["cây xô thơm","xô thơm"],["la xo thom sage","cay xo thom","xo thom"],["sage leaf","fresh sage"],false],["ing_0215_tarragon","tarragon","ngải giấm tarragon","tarragon","herbs_aromatics",146,["lá ngải giấm","rau ngải giấm"],["ngai giam tarragon","la ngai giam","rau ngai giam"],["tarragon leaf","fresh tarragon"],false],["ing_0216_marjoram","marjoram","kinh giới ngọt marjoram","marjoram","herbs_aromatics",35,["lá kinh giới ngọt"],["kinh gioi ngot marjoram","la kinh gioi ngot"],["fresh marjoram"],false],["ing_0217_assorted_herbs","assorted herbs","các loại rau thơm","assorted herbs","herbs_aromatics",9,["rau thơm hỗn hợp"],["cac loai rau thom","rau thom hon hop"],[],false],["ing_0218_tender_herbs_such_as_dill_or_parsley","tender herbs such as dill or parsley","rau thơm mềm như thì là hoặc mùi tây","tender herbs such as dill or parsley","herbs_aromatics",1,[],["rau thom mem nhu thi la hoac mui tay"],[],false],["ing_0219_kaffir_lime_leaf","kaffir lime leaf","lá chanh Thái","kaffir lime leaf","herbs_aromatics",15,["lá chanh","lá chanh chúc"],["la chanh thai","la chanh","la chanh chuc"],["makrut lime leaf","lime leaves"],false],["ing_0220_curry_leaf","curry leaf","lá cà ri tươi","curry leaf","herbs_aromatics",27,["lá cà ri"],["la ca ri tuoi","la ca ri"],["fresh curry leaves"],false],["ing_0221_thai_chile","thai chile","ớt hiểm","thai chile","herbs_aromatics",12,["quả ớt hiểm","ớt chỉ thiên","ớt cay","ớt tươi","ớt đỏ cay"],["ot hiem","qua ot hiem","ot chi thien","ot cay","ot tuoi","ot do cay"],["thai chiles","bird chile","birds eye chili"],false],["ing_0222_jalape_o","jalapeño","ớt jalapeño","jalapeño","herbs_aromatics",109,["ớt xanh Mexico jalapeño"],["ot jalapeno","ot xanh mexico jalapeno"],["jalapeno","jalapeño chile","jalapeño pepper"],false],["ing_0223_serrano_chile","serrano chile","ớt serrano","serrano chile","herbs_aromatics",84,["ớt cay serrano"],["ot serrano","ot cay serrano"],["serrano","serrano pepper"],false],["ing_0224_poblano_chile","poblano chile","ớt poblano","poblano chile","herbs_aromatics",38,["ớt xanh poblano"],["ot poblano","ot xanh poblano"],["poblano pepper","fresh poblano chile"],false],["ing_0225_red_chile","red chile","ớt sừng đỏ","red chile","herbs_aromatics",46,["ớt đỏ tươi","ớt sừng"],["ot sung do","ot do tuoi","ot sung"],["fresno chile","red chili"],false],["ing_0226_horseradish","horseradish","củ cải ngựa horseradish","horseradish","herbs_aromatics",18,["cải ngựa mài","mù tạt củ cải ngựa"],["cu cai ngua horseradish","cai ngua mai","mu tat cu cai ngua"],["prepared horseradish","bottled horseradish","prepared white horseradish"],false],["ing_0227_lemon","lemon","chanh vàng","lemon","fruits",327,["quả chanh vàng","trái chanh vàng"],["chanh vang","qua chanh vang","trai chanh vang"],["lemons","lemon wedges"],false],["ing_0228_lemon_juice","lemon juice","nước cốt chanh vàng","lemon juice","fruits",1810,["nước chanh vàng"],["nuoc cot chanh vang","nuoc chanh vang"],["fresh lemon juice","squeezed lemon juice","juice of 1 lemon","juice of 1/2 lemon"],false],["ing_0229_lemon_zest","lemon zest","vỏ chanh vàng bào","lemon zest","fruits",535,["vỏ chanh vàng","vỏ chanh bào"],["vo chanh vang bao","vo chanh vang","vo chanh bao"],["lemon peel","grated lemon zest","zest of 1 lemon"],false],["ing_0230_preserved_lemon","preserved lemon","chanh vàng muối","preserved lemon","fruits",8,["chanh muối kiểu Ma-rốc"],["chanh vang muoi","chanh muoi kieu ma-roc"],[],false],["ing_0231_lime","lime","chanh xanh","lime","fruits",125,["chanh","quả chanh xanh","trái chanh","chanh ta","chanh không hạt"],["chanh xanh","chanh","qua chanh xanh","trai chanh","chanh ta","chanh khong hat"],["limes"],true],["ing_0232_lime_juice","lime juice","nước cốt chanh xanh","lime juice","fruits",790,["nước cốt chanh","nước chanh tươi"],["nuoc cot chanh xanh","nuoc cot chanh","nuoc chanh tuoi"],["squeezed lime juice","fresh lime juice","freshly squeezed lime juice","juice of 1 lime"],false],["ing_0233_lime_zest","lime zest","vỏ chanh xanh bào","lime zest","fruits",97,["vỏ chanh xanh"],["vo chanh xanh bao","vo chanh xanh"],["grated lime zest","lime peel","zest of 1 lime"],false],["ing_0234_lime_wedge","lime wedge","múi chanh xanh","lime wedge","fruits",11,["lát chanh xanh","miếng chanh"],["mui chanh xanh","lat chanh xanh","mieng chanh"],["lime wedges"],false],["ing_0235_orange","orange","cam","orange","fruits",89,["quả cam","trái cam","cam tươi"],["cam","qua cam","trai cam","cam tuoi"],["oranges","navel orange","blood orange"],false],["ing_0236_orange_juice","orange juice","nước cam","orange juice","fruits",305,["nước cam ép","nước cốt cam"],["nuoc cam","nuoc cam ep","nuoc cot cam"],["squeezed orange juice","fresh orange juice","blood orange juice"],false],["ing_0237_orange_zest","orange zest","vỏ cam bào","orange zest","fruits",197,["vỏ cam"],["vo cam bao","vo cam"],["orange peel","zest of 1 orange","grated orange zest"],false],["ing_0238_grapefruit","grapefruit","bưởi chùm grapefruit","grapefruit","fruits",14,["bưởi đào","bưởi đỏ","quả bưởi"],["buoi chum grapefruit","buoi dao","buoi do","qua buoi"],["pink grapefruit"],false],["ing_0239_grapefruit_juice","grapefruit juice","nước ép bưởi","grapefruit juice","fruits",39,["nước bưởi ép"],["nuoc ep buoi","nuoc buoi ep"],["pink grapefruit juice","grapefruit zest"],false],["ing_0240_apple","apple","táo","apple","fruits",53,["quả táo","trái táo","táo tươi"],["tao","qua tao","trai tao","tao tuoi"],["apples","gala apple","fuji apple","pink lady apple","golden delicious apple"],true],["ing_0241_granny_smith_apple","granny smith apple","táo xanh Granny Smith","granny smith apple","fruits",64,["táo xanh","quả táo xanh"],["tao xanh granny smith","tao xanh","qua tao xanh"],["green apple"],false],["ing_0242_apple_juice","apple juice","nước ép táo","apple juice","fruits",21,["nước táo"],["nuoc ep tao","nuoc tao"],["apple cider","unfiltered apple cider"],false],["ing_0243_applesauce","applesauce","sốt táo nghiền","applesauce","fruits",12,["táo nghiền"],["sot tao nghien","tao nghien"],["unsweetened applesauce"],false],["ing_0244_banana","banana","chuối","banana","fruits",42,["quả chuối","trái chuối","chuối chín"],["chuoi","qua chuoi","trai chuoi","chuoi chin"],["bananas","ripe banana","very ripe banana"],true],["ing_0245_strawberry","strawberry","dâu tây","strawberry","fruits",61,["quả dâu tây","trái dâu tây"],["dau tay","qua dau tay","trai dau tay"],["strawberries","hulled strawberry","fresh strawberries"],true],["ing_0246_blueberry","blueberry","việt quất","blueberry","fruits",84,["quả việt quất"],["viet quat","qua viet quat"],["blueberries","fresh blueberries"],false],["ing_0247_raspberry","raspberry","phúc bồn tử đỏ","raspberry","fruits",97,["quả mâm xôi đỏ","phúc bồn tử"],["phuc bon tu do","qua mam xoi do","phuc bon tu"],["raspberries","frozen raspberry"],false],["ing_0248_blackberry","blackberry","mâm xôi đen","blackberry","fruits",55,["quả mâm xôi đen","dâu tằm đen"],["mam xoi den","qua mam xoi den","dau tam den"],["blackberries"],false],["ing_0249_cranberry","cranberry","nam việt quất tươi","cranberry","fruits",40,["quả nam việt quất"],["nam viet quat tuoi","qua nam viet quat"],["cranberries","fresh cranberries"],false],["ing_0250_dried_cranberry","dried cranberry","nam việt quất khô","dried cranberry","fruits",62,["mứt nam việt quất sấy"],["nam viet quat kho","mut nam viet quat say"],["dried cranberries","craisins"],false],["ing_0251_cherry","cherry","anh đào tươi (cherry)","cherry","fruits",20,["quả cherry","trái anh đào"],["anh dao tuoi (cherry)","qua cherry","trai anh dao"],["cherries","sweet cherries","maraschino cherry"],false],["ing_0252_dried_cherry","dried cherry","anh đào khô","dried cherry","fruits",23,["cherry sấy khô"],["anh dao kho","cherry say kho"],["dried tart cherry","dried cherries"],false],["ing_0253_peach","peach","đào","peach","fruits",36,["quả đào","trái đào","đào chín"],["dao","qua dao","trai dao","dao chin"],["peaches","ripe peach"],false],["ing_0254_nectarines","nectarines","đào trơn xuân đào","nectarines","fruits",10,["quả xuân đào"],["dao tron xuan dao","qua xuan dao"],["nectarine"],false],["ing_0255_plum","plum","mận","plum","fruits",16,["quả mận","trái mận"],["man","qua man","trai man"],["plums","red plum"],false],["ing_0256_apricot","apricot","mơ tươi","apricot","fruits",19,["quả mơ"],["mo tuoi","qua mo"],["apricots"],false],["ing_0257_dried_apricot","dried apricot","mơ sấy khô","dried apricot","fruits",58,["quả mơ khô"],["mo say kho","qua mo kho"],["dried california apricot","dried apricots"],false],["ing_0258_mango","mango","xoài","mango","fruits",25,["quả xoài","trái xoài","xoài chín"],["xoai","qua xoai","trai xoai","xoai chin"],["mangoes","ripe mango"],false],["ing_0259_pineapple","pineapple","dứa","pineapple","fruits",46,["thơm","khóm","quả dứa","trái thơm","thơm (dứa)","quả thơm (dứa)"],["dua","thom","khom","qua dua","trai thom","thom (dua)","qua thom (dua)"],["fresh pineapple"],false],["ing_0260_pineapple_juice","pineapple juice","nước ép dứa","pineapple juice","fruits",36,["nước thơm ép"],["nuoc ep dua","nuoc thom ep"],[],false],["ing_0261_avocado","avocado","quả bơ","avocado","fruits",149,["trái bơ","bơ sáp","quả bơ chín"],["qua bo","trai bo","bo sap","qua bo chin"],["avocados","ripe avocado"],false],["ing_0262_coconut","coconut","dừa tươi","coconut","fruits",9,["trái dừa tươi","cùi dừa tươi"],["dua tuoi","trai dua tuoi","cui dua tuoi"],["fresh coconut"],false],["ing_0263_coconut_water","coconut water","nước dừa tươi","coconut water","fruits",14,["nước dừa"],["nuoc dua tuoi","nuoc dua"],[],false],["ing_0264_unsweetened_coconut","unsweetened coconut","dừa nạo không đường","unsweetened coconut","fruits",59,["cơm dừa sấy không đường"],["dua nao khong duong","com dua say khong duong"],["unsweetened coconut flakes","unsweetened dried coconut"],false],["ing_0265_sweetened_flaked_coconut","sweetened flaked coconut","dừa nạo sấy có đường","sweetened flaked coconut","fruits",34,["dừa sấy ngọt"],["dua nao say co duong","dua say ngot"],["sweetened coconut"],false],["ing_0266_pear","pear","lê","pear","fruits",17,["quả lê","trái lê"],["le","qua le","trai le"],["pears","bosc pear","asian pear","anjou pear"],false],["ing_0267_seedless_red_grape","seedless red grape","nho đỏ không hạt","seedless red grape","fruits",13,["nho","quả nho","nho tươi"],["nho do khong hat","nho","qua nho","nho tuoi"],["grapes","red seedless grape","green grapes"],false],["ing_0268_raisin","raisin","nho khô","raisin","fruits",71,["nho sấy khô"],["nho kho","nho say kho"],["raisins"],false],["ing_0269_golden_raisin","golden raisin","nho khô vàng","golden raisin","fruits",109,["nho vàng sấy"],["nho kho vang","nho vang say"],["golden raisins"],false],["ing_0270_dried_currant","dried currant","nho chuỗi ngọc khô","dried currant","fruits",51,["nho đen nhỏ sấy khô"],["nho chuoi ngoc kho","nho den nho say kho"],["dried currants","currants"],false],["ing_0271_date","date","chà là","date","fruits",15,["quả chà là","chà là sấy"],["cha la","qua cha la","cha la say"],["dates","medjool date","pitted date","pitted medjool date"],false],["ing_0272_fig","fig","sung Mỹ tươi","fig","fruits",13,["quả sung ngọt","trái vả"],["sung my tuoi","qua sung ngot","trai va"],["figs","fresh figs"],false],["ing_0273_dried_fig","dried fig","sung Mỹ sấy khô","dried fig","fruits",7,["quả sung khô"],["sung my say kho","qua sung kho"],["dried figs"],false],["ing_0274_pomegranate_seed","pomegranate seed","hạt lựu","pomegranate seed","fruits",64,["lựu","quả lựu"],["hat luu","luu","qua luu"],["pomegranate","pomegranate arils"],false],["ing_0275_pomegranate_juice","pomegranate juice","nước ép lựu","pomegranate juice","fruits",41,["nước lựu"],["nuoc ep luu","nuoc luu"],[],false],["ing_0276_rhubarb","rhubarb","đại hoàng rhubarb","rhubarb","fruits",24,["dọc đại hoàng"],["dai hoang rhubarb","doc dai hoang"],["fresh rhubarb"],false],["ing_0277_huckleberries","huckleberries","quả huckleberry","huckleberries","fruits",1,[],["qua huckleberry"],["huckleberry"],false],["ing_0278_milk","milk","sữa","milk","dairy_cheese",202,["sữa tươi","sữa tươi không đường"],["sua","sua tuoi","sua tuoi khong duong"],[],true],["ing_0279_whole_milk","whole milk","sữa nguyên kem","whole milk","dairy_cheese",798,["sữa tươi nguyên kem"],["sua nguyen kem","sua tuoi nguyen kem"],[],false],["ing_0280_sweetened_condensed_milk","sweetened condensed milk","sữa đặc có đường","sweetened condensed milk","dairy_cheese",64,["sữa đặc","sữa ông thọ"],["sua dac co duong","sua dac","sua ong tho"],["condensed milk"],false],["ing_0281_buttermilk","buttermilk","sữa bơ buttermilk","buttermilk","dairy_cheese",277,["sữa lên men buttermilk"],["sua bo buttermilk","sua len men buttermilk"],["well-shaken buttermilk"],false],["ing_0282_heavy_cream","heavy cream","kem béo","heavy cream","dairy_cheese",831,["kem tươi whipping","kem sữa béo"],["kem beo","kem tuoi whipping","kem sua beo"],["heavy whipping cream","whipping cream"],true],["ing_0283_whipped_cream","whipped cream","kem tươi đánh bông","whipped cream","dairy_cheese",39,["kem bông"],["kem tuoi danh bong","kem bong"],["sweetened whipped cream"],false],["ing_0284_half_and_half","half-and-half","kem sữa pha half-and-half","half-and-half","dairy_cheese",69,["sữa kem half and half"],["kem sua pha half-and-half","sua kem half and half"],["half and half"],false],["ing_0285_sour_cream","sour cream","kem chua","sour cream","dairy_cheese",320,["sốt kem chua"],["kem chua","sot kem chua"],[],false],["ing_0286_cr_me_fra_che","crème fraîche","kem chua Pháp crème fraîche","crème fraîche","dairy_cheese",115,["kem creme fraiche"],["kem chua phap creme fraiche","kem creme fraiche"],["creme fraiche"],false],["ing_0287_plain_yogurt","plain yogurt","sữa chua không đường","plain yogurt","dairy_cheese",71,["sữa chua","sữa chua trắng"],["sua chua khong duong","sua chua","sua chua trang"],["plain whole-milk yogurt","yogurt"],false],["ing_0288_plain_greek_yogurt","plain greek yogurt","sữa chua Hy Lạp","plain greek yogurt","dairy_cheese",49,["sữa chua Hy Lạp nguyên kem"],["sua chua hy lap","sua chua hy lap nguyen kem"],["plain whole-milk greek yogurt","greek yogurt"],false],["ing_0289_butter","butter","bơ","butter","dairy_cheese",656,["bơ sữa"],["bo sua"],[],true],["ing_0290_unsalted_butter","unsalted butter","bơ lạt","unsalted butter","dairy_cheese",3182,["bơ không muối","bơ nhạt"],["bo lat","bo khong muoi","bo nhat"],[],false],["ing_0291_salted_butter","salted butter","bơ mặn","salted butter","dairy_cheese",32,["bơ có muối"],["bo man","bo co muoi"],["salted butter, cubed"],false],["ing_0292_cheese","cheese","phô mai","cheese","dairy_cheese",6,["phô-mát","pho mát"],["pho mai","pho-mat","pho mat"],["cheeses"],true],["ing_0293_cream_cheese","cream cheese","phô mai kem (cream cheese)","cream cheese","dairy_cheese",204,["kem phô mai","phô mai cream cheese"],["pho mai kem (cream cheese)","kem pho mai","pho mai cream cheese"],["philadelphia-brand cream cheese"],false],["ing_0294_parmesan_cheese","parmesan cheese","phô mai Parmesan","parmesan cheese","dairy_cheese",258,["phô mai bột parmesan","parmesan bào"],["pho mai parmesan","pho mai bot parmesan","parmesan bao"],["parmesan","parmigiano-reggiano","parmigiano reggiano"],false],["ing_0295_mozzarella_cheese","mozzarella cheese","phô mai Mozzarella","mozzarella cheese","dairy_cheese",20,["phô mai kéo sợi","mozzarella bào"],["pho mai mozzarella","pho mai keo soi","mozzarella bao"],["mozzarella","fresh mozzarella"],false],["ing_0296_cheddar_cheese","cheddar cheese","phô mai Cheddar","cheddar cheese","dairy_cheese",21,["phô mai lát cheddar","phô mai vàng cheddar"],["pho mai cheddar","pho mai lat cheddar","pho mai vang cheddar"],["cheddar","sharp cheddar","sharp cheddar cheese","white cheddar"],false],["ing_0297_goat_cheese","goat cheese","phô mai dê","goat cheese","dairy_cheese",51,["phô mai sữa dê"],["pho mai de","pho mai sua de"],["chèvre","chevre","soft goat cheese"],true],["ing_0298_feta_cheese","feta cheese","phô mai Feta","feta cheese","dairy_cheese",24,["phô mai mặn Hy Lạp feta"],["pho mai feta","pho mai man hy lap feta"],["feta","crumbled feta"],false],["ing_0299_ricotta_cheese","ricotta cheese","phô mai Ricotta","ricotta cheese","dairy_cheese",23,["phô mai tươi ricotta"],["pho mai ricotta","pho mai tuoi ricotta"],["ricotta","whole-milk ricotta"],false],["ing_0300_mascarpone_cheese","mascarpone cheese","phô mai Mascarpone","mascarpone cheese","dairy_cheese",34,["kem phô mai Ý mascarpone"],["pho mai mascarpone","kem pho mai y mascarpone"],["mascarpone"],false],["ing_0301_gruy_re_cheese","gruyère cheese","phô mai Gruyère","gruyère cheese","dairy_cheese",34,["phô mai Thụy Sĩ gruyere"],["pho mai gruyere","pho mai thuy si gruyere"],["gruyere","gruyère","gruyere cheese"],false],["ing_0302_pecorino_romano_cheese","pecorino romano cheese","phô mai cừu Pecorino","pecorino romano cheese","dairy_cheese",36,["phô mai pecorino"],["pho mai cuu pecorino","pho mai pecorino"],["pecorino","pecorino romano"],false],["ing_0303_fontina_cheese","fontina cheese","phô mai Fontina","fontina cheese","dairy_cheese",38,["phô mai Ý fontina"],["pho mai fontina","pho mai y fontina"],["fontina"],false],["ing_0304_monterey_jack_cheese","monterey jack cheese","phô mai Monterey Jack","monterey jack cheese","dairy_cheese",43,[],["pho mai monterey jack"],["monterey jack"],false],["ing_0305_burrata_cheese","burrata cheese","phô mai tươi Burrata","burrata cheese","dairy_cheese",2,["phô mai burrata"],["pho mai tuoi burrata","pho mai burrata"],["burrata"],false],["ing_0306_vanilla_ice_cream","vanilla ice cream","kem vani","vanilla ice cream","dairy_cheese",96,["kem lạnh vị vani"],["kem vani","kem lanh vi vani"],["ice cream"],false],["ing_0307_cooked_rice","cooked rice","cơm nguội","cooked rice","grains_noodles_bread",15,["cơm trắng","cơm chín","cơm nóng"],["com nguoi","com trang","com chin","com nong"],["cooked white rice","steamed rice"],false],["ing_0308_long_grain_white_rice","long-grain white rice","gạo tẻ hạt dài","long-grain white rice","grains_noodles_bread",40,["gạo trắng","gạo tẻ","gạo nấu cơm"],["gao te hat dai","gao trang","gao te","gao nau com"],["white rice","long-grain rice"],false],["ing_0309_jasmine_rice","jasmine rice","gạo thơm Jasmine","jasmine rice","grains_noodles_bread",21,["gạo lài","gạo thơm Thái"],["gao thom jasmine","gao lai","gao thom thai"],[],false],["ing_0310_basmati_rice","basmati rice","gạo Basmati Ấn Độ","basmati rice","grains_noodles_bread",28,["gạo hạt dài basmati"],["gao basmati an do","gao hat dai basmati"],[],false],["ing_0311_arborio_rice","arborio rice","gạo Ý Arborio nấu risotto","arborio rice","grains_noodles_bread",29,["gạo risotto","gạo hạt tròn arborio"],["gao y arborio nau risotto","gao risotto","gao hat tron arborio"],["carnaroli rice"],false],["ing_0312_short_grain_rice","short-grain rice","gạo Nhật hạt tròn","short-grain rice","grains_noodles_bread",6,["gạo sushi","gạo hạt ngắn"],["gao nhat hat tron","gao sushi","gao hat ngan"],["sushi rice","short-grain brown rice"],false],["ing_0313_wild_rice","wild rice","gạo đen hoang dã","wild rice","grains_noodles_bread",17,["gạo lứt đen"],["gao den hoang da","gao lut den"],[],false],["ing_0314_egg_noodle","egg noodle","mì trứng","egg noodle","grains_noodles_bread",6,["vắt mì trứng","mì sợi trứng"],["mi trung","vat mi trung","mi soi trung"],["egg noodles"],false],["ing_0315_dried_wide_egg_noodle","dried wide egg noodle","mì trứng khô bản rộng","dried wide egg noodle","grains_noodles_bread",1,["mì trứng sợi dẹt"],["mi trung kho ban rong","mi trung soi det"],[],false],["ing_0316_spaghetti","spaghetti","mì Ý spaghetti","spaghetti","grains_noodles_bread",50,["mì spaghetti","mì Ý sợi tròn"],["mi y spaghetti","mi spaghetti","mi y soi tron"],[],false],["ing_0317_linguine","linguine","mì Ý sợi dẹt linguine","linguine","grains_noodles_bread",31,["mì linguine"],["mi y soi det linguine","mi linguine"],[],false],["ing_0318_fettuccine","fettuccine","mì Ý bản rộng fettuccine","fettuccine","grains_noodles_bread",5,["mì fettuccine"],["mi y ban rong fettuccine","mi fettuccine"],["dried egg fettuccine"],false],["ing_0319_penne","penne","nui ống penne","penne","grains_noodles_bread",13,["mì ống penne","nui ống"],["nui ong penne","mi ong penne","nui ong"],["penne rigate"],false],["ing_0320_rigatoni","rigatoni","nui ống lớn rigatoni","rigatoni","grains_noodles_bread",12,["mì ống rigatoni"],["nui ong lon rigatoni","mi ong rigatoni"],[],false],["ing_0321_orzo","orzo","mì hạt gạo orzo","orzo","grains_noodles_bread",22,["nui hạt gạo"],["mi hat gao orzo","nui hat gao"],[],false],["ing_0322_pasta","pasta","mì ống / nui Ý","pasta","grains_noodles_bread",12,["nui","mì Ý"],["mi ong / nui y","nui","mi y"],["macaroni","elbow macaroni"],false],["ing_0323_soba_noodle","soba noodle","mì kiều mạch soba","soba noodle","grains_noodles_bread",8,["mì soba Nhật"],["mi kieu mach soba","mi soba nhat"],["soba noodles","buckwheat noodles"],false],["ing_0324_bread","bread","bánh mì","bread","grains_noodles_bread",5,["bánh mỳ","ổ bánh mì","bánh mì lát"],["banh mi","banh my","o banh mi","banh mi lat"],["breads","white bread","firm white sandwich bread","sandwich bread"],true],["ing_0325_baguette","baguette","bánh mì Pháp baguette","baguette","grains_noodles_bread",46,["bánh mì ổ dài","bánh mì que Pháp"],["banh mi phap baguette","banh mi o dai","banh mi que phap"],["french bread"],false],["ing_0326_country_style_bread","country-style bread","bánh mì vỏ giòn kiểu quê","country-style bread","grains_noodles_bread",24,["bánh mì sourdough","bánh mì vỏ cứng"],["banh mi vo gion kieu que","banh mi sourdough","banh mi vo cung"],["crusty bread","sourdough bread","ciabatta bread"],false],["ing_0327_loaf_of_stale_french_bread","loaf of stale french bread","ổ bánh mì Pháp để khô","loaf of stale french bread","grains_noodles_bread",1,[],["o banh mi phap de kho"],[],false],["ing_0328_hamburger_buns","hamburger buns","vỏ bánh mì burger","hamburger buns","grains_noodles_bread",14,["bánh mì tròn kẹp thịt"],["vo banh mi burger","banh mi tron kep thit"],["burger buns"],false],["ing_0329_bread_crumbs","bread crumbs","vụn bánh mì","bread crumbs","grains_noodles_bread",27,["bột chiên xù mịn"],["vun banh mi","bot chien xu min"],["fine dry bread crumbs","coarse bread crumbs","breadcrumb","coarse breadcrumb","fine bread crumbs","plain breadcrumb"],false],["ing_0330_panko","panko","bột chiên xù Nhật (panko)","panko","grains_noodles_bread",96,["bột chiên xù","vụn bánh mì panko"],["bot chien xu nhat (panko)","bot chien xu","vun banh mi panko"],["panko bread crumbs","panko breadcrumb"],false],["ing_0331_corn_tortilla","corn tortilla","bánh tráng ngô tortilla","corn tortilla","grains_noodles_bread",79,["vỏ bánh taco ngô","bánh tortilla bắp"],["banh trang ngo tortilla","vo banh taco ngo","banh tortilla bap"],["corn tortillas"],false],["ing_0332_flour_tortilla","flour tortilla","vỏ bánh cuộn bột mì tortilla","flour tortilla","grains_noodles_bread",21,["bánh tortilla bột mì","vỏ bánh burrito"],["vo banh cuon bot mi tortilla","banh tortilla bot mi","vo banh burrito"],["flour tortillas"],false],["ing_0333_tortilla_chips","tortilla chips","bánh ngô chiên giòn nachos","tortilla chips","grains_noodles_bread",15,["bánh snack ngô","bánh nachos"],["banh ngo chien gion nachos","banh snack ngo","banh nachos"],[],false],["ing_0334_potato_chips","potato chips","khoai tây lát chiên giòn","potato chips","grains_noodles_bread",6,["bimbim khoai tây"],["khoai tay lat chien gion","bimbim khoai tay"],[],false],["ing_0335_frozen_puff_pastry","frozen puff pastry","vỏ bánh ngàn lớp đông lạnh","frozen puff pastry","grains_noodles_bread",22,["bột ngàn lớp puff pastry"],["vo banh ngan lop dong lanh","bot ngan lop puff pastry"],["puff pastry","puff pastry sheets"],false],["ing_0336_flour","flour","bột mì","flour","grains_noodles_bread",85,["bột mỳ"],["bot mi","bot my"],[],true],["ing_0337_all_purpose_flour","all-purpose flour","bột mì đa dụng","all-purpose flour","grains_noodles_bread",1548,["bột mì số 11","bột mì thường"],["bot mi da dung","bot mi so 11","bot mi thuong"],["all purpose flour"],false],["ing_0338_unbleached_all_purpose_flour","unbleached all-purpose flour","bột mì đa dụng không tẩy trắng","unbleached all-purpose flour","grains_noodles_bread",73,[],["bot mi da dung khong tay trang"],["unbleached all purpose flour"],false],["ing_0339_self_rising_flour","self-rising flour","bột mì tự nở","self-rising flour","grains_noodles_bread",25,["bột mì pha sẵn bột nở"],["bot mi tu no","bot mi pha san bot no"],[],false],["ing_0340_bread_flour","bread flour","bột mì làm bánh mì (số 13)","bread flour","grains_noodles_bread",27,["bột bánh mì"],["bot mi lam banh mi (so 13)","bot banh mi"],[],false],["ing_0341_cake_flour","cake flour","bột mì làm bánh bông lan (số 8)","cake flour","grains_noodles_bread",95,["bột làm bánh ngọt","bột cake flour"],["bot mi lam banh bong lan (so 8)","bot lam banh ngot","bot cake flour"],["pastry flour"],false],["ing_0342_whole_wheat_flour","whole wheat flour","bột mì nguyên cám","whole wheat flour","grains_noodles_bread",58,["bột mì đen nguyên cám"],["bot mi nguyen cam","bot mi den nguyen cam"],["whole-wheat flour"],false],["ing_0343_rice_flour","rice flour","bột gạo","rice flour","grains_noodles_bread",19,["bột gạo tẻ"],["bot gao","bot gao te"],["white rice flour"],false],["ing_0344_chickpea_flour","chickpea flour","bột đậu gà","chickpea flour","grains_noodles_bread",21,["bột gram Ấn Độ"],["bot dau ga","bot gram an do"],["besan","gram flour"],false],["ing_0345_cornstarch","cornstarch","bột bắp (tinh bột ngô)","cornstarch","grains_noodles_bread",404,["bột bắp","tinh bột ngô","bột ngô"],["bot bap (tinh bot ngo)","bot bap","tinh bot ngo","bot ngo"],["corn starch"],false],["ing_0346_potato_starch","potato starch","tinh bột khoai tây","potato starch","grains_noodles_bread",27,["bột khoai tây"],["tinh bot khoai tay","bot khoai tay"],[],false],["ing_0347_cornmeal","cornmeal","bột ngô hạt tấm","cornmeal","grains_noodles_bread",53,["bột bắp hạt thô"],["bot ngo hat tam","bot bap hat tho"],["yellow cornmeal"],false],["ing_0348_polenta","polenta","bột ngô nấu polenta","polenta","grains_noodles_bread",27,["bột bắp Ý polenta"],["bot ngo nau polenta","bot bap y polenta"],[],false],["ing_0349_old_fashioned_oats","old-fashioned oats","yến mạch cán dẹt","old-fashioned oats","grains_noodles_bread",62,["yến mạch","hạt yến mạch"],["yen mach can det","yen mach","hat yen mach"],["rolled oats","old-fashioned rolled oats","oats"],false],["ing_0350_quinoa","quinoa","hạt diêm mạch (quinoa)","quinoa","grains_noodles_bread",22,["diêm mạch","hạt quinoa"],["hat diem mach (quinoa)","diem mach","hat quinoa"],["cooked quinoa"],false],["ing_0351_couscous","couscous","hạt bột mì couscous","couscous","grains_noodles_bread",12,["hạt couscous"],["hat bot mi couscous","hat couscous"],["israeli couscous"],false],["ing_0352_bulgur","bulgur","lúa mì nứt bulgur","bulgur","grains_noodles_bread",14,["hạt lúa mì bulgur"],["lua mi nut bulgur","hat lua mi bulgur"],["bulgur wheat"],false],["ing_0353_farro","farro","hạt lúa mì cổ đại farro","farro","grains_noodles_bread",9,["lúa mạch farro"],["hat lua mi co dai farro","lua mach farro"],[],false],["ing_0354_pearl_barley","pearl barley","hạt ý dĩ / lúa mạch vo tròn","pearl barley","grains_noodles_bread",16,["hạt bo bo","lúa mạch"],["hat y di / lua mach vo tron","hat bo bo","lua mach"],["barley"],false],["ing_0355_graham_cracker_crumbs","graham cracker crumbs","vụn bánh quy graham","graham cracker crumbs","grains_noodles_bread",20,["bánh quy nghiền làm đế bánh"],["vun banh quy graham","banh quy nghien lam de banh"],["graham crackers"],false],["ing_0356_matzo_meal","matzo meal","bột bánh quy không men matzo","matzo meal","grains_noodles_bread",20,["bột bánh matzo"],["bot banh quy khong men matzo","bot banh matzo"],[],false],["ing_0357_black_bean","black bean","đậu đen","black bean","legumes_nuts_seeds",43,["hạt đậu đen","đỗ đen"],["dau den","hat dau den","do den"],["black beans","canned black beans"],false],["ing_0358_white_bean","white bean","đậu trắng","white bean","legumes_nuts_seeds",26,["hạt đậu trắng"],["dau trang","hat dau trang"],["white beans","navy beans"],false],["ing_0359_cannellini_bean","cannellini bean","đậu trắng Ý cannellini","cannellini bean","legumes_nuts_seeds",27,["đậu cannellini"],["dau trang y cannellini","dau cannellini"],["cannellini beans"],false],["ing_0360_pinto_bean","pinto bean","đậu cút pinto","pinto bean","legumes_nuts_seeds",9,["đậu đốm pinto"],["dau cut pinto","dau dom pinto"],["pinto beans"],false],["ing_0361_chickpea","chickpea","đậu gà","chickpea","legumes_nuts_seeds",67,["hạt đậu gà"],["dau ga","hat dau ga"],["chickpeas","garbanzo bean","garbanzo beans","canned chickpea","dried chickpea"],false],["ing_0362_red_lentil","red lentil","đậu lăng đỏ","red lentil","legumes_nuts_seeds",9,["hạt đậu lăng","đậu lăng"],["dau lang do","hat dau lang","dau lang"],["lentils","brown lentils","green lentils","french green lentils"],false],["ing_0363_black_eyed_pea","black-eyed pea","đậu trắng mắt đen","black-eyed pea","legumes_nuts_seeds",9,["đậu mắt đen"],["dau trang mat den","dau mat den"],["black-eyed peas"],false],["ing_0364_frozen_shelled_edamame","frozen shelled edamame","đậu nành Nhật edamame","frozen shelled edamame","legumes_nuts_seeds",10,["đậu tương lông","đậu edamame"],["dau nanh nhat edamame","dau tuong long","dau edamame"],["edamame"],false],["ing_0365_almond","almond","hạnh nhân","almond","legumes_nuts_seeds",152,["hạt hạnh nhân"],["hanh nhan","hat hanh nhan"],["almonds","whole almond","blanched almond","slivered almond","sliced almonds"],false],["ing_0366_walnut","walnut","hạt óc chó","walnut","legumes_nuts_seeds",189,["quả óc chó","nhân hạt óc chó"],["hat oc cho","qua oc cho","nhan hat oc cho"],["walnuts","walnut halves","walnut pieces"],false],["ing_0367_pecan","pecan","hạt hồ đào","pecan","legumes_nuts_seeds",139,["hạt hồ đào pecan","quả hồ đào"],["hat ho dao","hat ho dao pecan","qua ho dao"],["pecans","pecan halves"],false],["ing_0368_pistachio","pistachio","hạt dẻ cười","pistachio","legumes_nuts_seeds",33,["quả hồ trăn","nhân hạt dẻ cười"],["hat de cuoi","qua ho tran","nhan hat de cuoi"],["pistachios","raw pistachio","shelled pistachios"],false],["ing_0369_hazelnut","hazelnut","hạt phỉ hazelnut","hazelnut","legumes_nuts_seeds",59,["hạt phỉ"],["hat phi hazelnut","hat phi"],["hazelnuts","blanched hazelnut"],false],["ing_0370_pine_nuts","pine nuts","hạt thông","pine nuts","legumes_nuts_seeds",140,["nhân hạt thông"],["hat thong","nhan hat thong"],["pine nut","pignoli"],false],["ing_0371_peanut","peanut","đậu phộng (lạc)","peanut","legumes_nuts_seeds",12,["đậu phộng","lạc","hạt lạc","đậu phộng rang"],["dau phong (lac)","dau phong","lac","hat lac","dau phong rang"],["peanuts","roasted peanut","salted roasted peanut","salted dry-roasted peanut"],false],["ing_0372_cashew","cashew","hạt điều","cashew","legumes_nuts_seeds",17,["hạt điều rang","nhân hạt điều"],["hat dieu","hat dieu rang","nhan hat dieu"],["cashews","raw cashews","roasted cashews"],false],["ing_0373_sesame_seed","sesame seed","hạt mè (vừng)","sesame seed","legumes_nuts_seeds",112,["mè trắng","vừng trắng","hạt vừng","hạt mè"],["hat me (vung)","me trang","vung trang","hat vung","hat me"],["sesame seeds","toasted sesame seeds"],false],["ing_0374_black_sesame_seed","black sesame seed","hạt mè đen (vừng đen)","black sesame seed","legumes_nuts_seeds",30,["mè đen","vừng đen"],["hat me den (vung den)","me den","vung den"],["black sesame seeds"],false],["ing_0375_pumpkin_seed","pumpkin seed","hạt bí xanh","pumpkin seed","legumes_nuts_seeds",15,["hạt bí","nhân hạt bí ngô"],["hat bi xanh","hat bi","nhan hat bi ngo"],["pepitas","raw pumpkin seed","shelled pumpkin seed"],false],["ing_0376_chia_seed","chia seed","hạt chia","chia seed","legumes_nuts_seeds",26,["hạt chia đen"],["hat chia","hat chia den"],["chia seeds"],false],["ing_0377_poppy_seed","poppy seed","hạt anh túc làm bánh","poppy seed","legumes_nuts_seeds",40,["hạt poppy"],["hat anh tuc lam banh","hat poppy"],["poppy seeds"],false],["ing_0378_fish_sauce","fish sauce","nước mắm","fish sauce","sauces_condiments_oils",188,["nước mắm ngon","mắm"],["nuoc mam","nuoc mam ngon","mam"],["asian fish sauce","nam pla","nuoc mam"],false],["ing_0379_soy_sauce","soy sauce","nước tương (xì dầu)","soy sauce","sauces_condiments_oils",413,["nước tương","xì dầu"],["nuoc tuong (xi dau)","nuoc tuong","xi dau"],["shoyu","tamari"],false],["ing_0380_low_sodium_soy_sauce","low-sodium soy sauce","nước tương ít muối","low-sodium soy sauce","sauces_condiments_oils",45,["xì dầu giảm mặn"],["nuoc tuong it muoi","xi dau giam man"],["reduced-sodium soy sauce","light soy sauce"],false],["ing_0381_dark_soy_sauce","dark soy sauce","nước tương đen đậm đặc","dark soy sauce","sauces_condiments_oils",12,["hắc xì dầu","xì dầu đen"],["nuoc tuong den dam dac","hac xi dau","xi dau den"],[],false],["ing_0382_oyster_sauce","oyster sauce","dầu hào","oyster sauce","sauces_condiments_oils",39,["sốt dầu hào"],["dau hao","sot dau hao"],[],false],["ing_0383_hoisin_sauce","hoisin sauce","tương đen hoisin","hoisin sauce","sauces_condiments_oils",46,["sốt hoisin","tương ngọt ăn phở"],["tuong den hoisin","sot hoisin","tuong ngot an pho"],["hoisin"],false],["ing_0384_sriracha","sriracha","tương ớt Sriracha","sriracha","sauces_condiments_oils",39,["tương ớt","sốt ớt cay sriracha"],["tuong ot sriracha","tuong ot","sot ot cay sriracha"],["sriracha sauce"],false],["ing_0385_chili_garlic_sauce","chili-garlic sauce","tương ớt tỏi","chili-garlic sauce","sauces_condiments_oils",17,["sốt ớt tỏi"],["tuong ot toi","sot ot toi"],["chili garlic sauce","sambal oelek"],false],["ing_0386_gochujang","gochujang","tương ớt Hàn Quốc gochujang","gochujang","sauces_condiments_oils",22,["sốt ớt Hàn Quốc","tương gochujang"],["tuong ot han quoc gochujang","sot ot han quoc","tuong gochujang"],["korean hot pepper paste"],false],["ing_0387_kimchi","kimchi","kim chi cải thảo","kimchi","sauces_condiments_oils",18,["kim chi","kimchi Hàn Quốc"],["kim chi cai thao","kim chi","kimchi han quoc"],["napa cabbage kimchi"],false],["ing_0388_white_miso","white miso","tương miso trắng","white miso","sauces_condiments_oils",61,["tương đậu nành Nhật miso","tương miso"],["tuong miso trang","tuong dau nanh nhat miso","tuong miso"],["miso","white miso paste","red miso","yellow miso"],false],["ing_0389_mirin","mirin","rượu gia vị Nhật mirin","mirin","sauces_condiments_oils",82,["rượu ngọt mirin"],["ruou gia vi nhat mirin","ruou ngot mirin"],["sweetened mirin"],false],["ing_0390_sake","sake","rượu sake nấu ăn","sake","sauces_condiments_oils",19,["rượu gạo Nhật sake"],["ruou sake nau an","ruou gao nhat sake"],["japanese sake"],false],["ing_0391_tahini","tahini","sốt bơ mè tahini","tahini","sauces_condiments_oils",75,["bơ vừng tahini","sốt mè nghiền"],["sot bo me tahini","bo vung tahini","sot me nghien"],["tahini paste"],false],["ing_0392_peanut_butter","peanut butter","bơ đậu phộng","peanut butter","sauces_condiments_oils",15,["bơ lạc"],["bo dau phong","bo lac"],["creamy peanut butter","smooth peanut butter","creamy natural peanut butter"],false],["ing_0393_mayonnaise","mayonnaise","sốt mayonnaise","mayonnaise","sauces_condiments_oils",372,["sốt mayo","xốt mayonnaise"],["sot mayonnaise","sot mayo","xot mayonnaise"],["mayo","good-quality mayonnaise"],false],["ing_0394_ketchup","ketchup","tương cà (ketchup)","ketchup","sauces_condiments_oils",95,["tương cà","sốt cà chua ketchup"],["tuong ca (ketchup)","tuong ca","sot ca chua ketchup"],["tomato ketchup"],false],["ing_0395_tomato_paste","tomato paste","cà chua cô đặc (tomato paste)","tomato paste","sauces_condiments_oils",213,["sốt cà chua đặc","cà chua nhuyễn cô đặc"],["ca chua co dac (tomato paste)","sot ca chua dac","ca chua nhuyen co dac"],["double-concentrated tomato paste"],false],["ing_0396_tomato_sauce","tomato sauce","sốt cà chua","tomato sauce","sauces_condiments_oils",44,["nước sốt cà chua"],["sot ca chua","nuoc sot ca chua"],["canned tomato sauce"],false],["ing_0397_dijon_mustard","dijon mustard","mù tạt vàng Dijon","dijon mustard","sauces_condiments_oils",420,["mù tạt Pháp dijon","sốt mù tạt"],["mu tat vang dijon","mu tat phap dijon","sot mu tat"],["mustard"],false],["ing_0398_whole_grain_mustard","whole-grain mustard","mù tạt nguyên hạt","whole-grain mustard","sauces_condiments_oils",22,["mù tạt hạt"],["mu tat nguyen hat","mu tat hat"],["whole grain mustard","grainy mustard","whole grain dijon mustard"],false],["ing_0399_worcestershire_sauce","worcestershire sauce","sốt Worcestershire","worcestershire sauce","sauces_condiments_oils",177,["nước sốt Anh worcestershire"],["sot worcestershire","nuoc sot anh worcestershire"],[],false],["ing_0400_hot_sauce","hot sauce","sốt ớt cay","hot sauce","sauces_condiments_oils",66,["tương ớt cay tabasco"],["sot ot cay","tuong ot cay tabasco"],["hot pepper sauce","tabasco","frank's redhot"],false],["ing_0401_harissa_paste","harissa paste","tương ớt Bắc Phi harissa","harissa paste","sauces_condiments_oils",21,["sốt ớt harissa"],["tuong ot bac phi harissa","sot ot harissa"],["harissa"],false],["ing_0402_caper","caper","nụ bạch hoa ngâm (capers)","caper","sauces_condiments_oils",183,["nụ bạch hoa","hạt caper"],["nu bach hoa ngam (capers)","nu bach hoa","hat caper"],["capers","drained capers"],false],["ing_0403_cornichons","cornichons","dưa chuột bao tử muối chua","cornichons","sauces_condiments_oils",16,["dưa leo muối chua","dưa chuột muối"],["dua chuot bao tu muoi chua","dua leo muoi chua","dua chuot muoi"],["dill pickles","pickles"],false],["ing_0404_tamarind","tamarind","me chua","tamarind","sauces_condiments_oils",1,["vắt me chua","cốt me","nước cốt me"],["me chua","vat me chua","cot me","nuoc cot me"],["tamarind concentrate","tamarind paste","tamarind pulp","me chua"],false],["ing_0405_pomegranate_molasses","pomegranate molasses","mật lựu cô đặc","pomegranate molasses","sauces_condiments_oils",35,["sốt mật lựu"],["mat luu co dac","sot mat luu"],[],false],["ing_0406_vegetable_oil","vegetable oil","dầu thực vật","vegetable oil","sauces_condiments_oils",1294,["dầu ăn","dầu chiên"],["dau thuc vat","dau an","dau chien"],["oil","cooking oil","neutral oil"],false],["ing_0407_olive_oil","olive oil","dầu ô liu","olive oil","sauces_condiments_oils",2613,["dầu olive"],["dau o liu","dau olive"],[],false],["ing_0408_extra_virgin_olive_oil","extra-virgin olive oil","dầu ô liu nguyên chất","extra-virgin olive oil","sauces_condiments_oils",2023,["dầu olive nguyên chất ép lạnh"],["dau o liu nguyen chat","dau olive nguyen chat ep lanh"],["extra virgin olive oil"],false],["ing_0409_canola_oil","canola oil","dầu cải","canola oil","sauces_condiments_oils",221,["dầu hạt cải"],["dau cai","dau hat cai"],[],false],["ing_0410_peanut_oil","peanut oil","dầu đậu phộng","peanut oil","sauces_condiments_oils",59,["dầu lạc"],["dau dau phong","dau lac"],[],false],["ing_0411_corn_oil","corn oil","dầu ngô","corn oil","sauces_condiments_oils",20,["dầu ngô bắp"],["dau ngo","dau ngo bap"],[],false],["ing_0412_grapeseed_oil","grapeseed oil","dầu hạt nho","grapeseed oil","sauces_condiments_oils",37,[],["dau hat nho"],[],false],["ing_0413_coconut_oil","coconut oil","dầu dừa","coconut oil","sauces_condiments_oils",50,["dầu dừa nguyên chất"],["dau dua","dau dua nguyen chat"],["virgin coconut oil"],false],["ing_0414_sesame_oil","sesame oil","dầu mè (dầu vừng)","sesame oil","sauces_condiments_oils",47,["dầu mè","dầu vừng","dầu mè thơm"],["dau me (dau vung)","dau me","dau vung","dau me thom"],["asian sesame oil","toasted sesame oil","dark sesame oil"],false],["ing_0415_distilled_white_vinegar","distilled white vinegar","giấm trắng","distilled white vinegar","sauces_condiments_oils",142,["giấm ăn","giấm gạo trắng"],["giam trang","giam an","giam gao trang"],["white vinegar"],false],["ing_0416_rice_vinegar","rice vinegar","giấm gạo","rice vinegar","sauces_condiments_oils",86,["giấm gạo Nhật"],["giam gao","giam gao nhat"],["unseasoned rice vinegar","seasoned rice vinegar","rice wine vinegar"],false],["ing_0417_apple_cider_vinegar","apple cider vinegar","giấm táo","apple cider vinegar","sauces_condiments_oils",233,["dấm táo"],["giam tao","dam tao"],["cider vinegar"],false],["ing_0418_red_wine_vinegar","red wine vinegar","giấm rượu vang đỏ","red wine vinegar","sauces_condiments_oils",314,["giấm vang đỏ"],["giam ruou vang do","giam vang do"],["red-wine vinegar"],false],["ing_0419_white_wine_vinegar","white wine vinegar","giấm rượu vang trắng","white wine vinegar","sauces_condiments_oils",202,["giấm vang trắng"],["giam ruou vang trang","giam vang trang"],["white-wine vinegar","champagne vinegar"],false],["ing_0420_balsamic_vinegar","balsamic vinegar","giấm đen Balsamic","balsamic vinegar","sauces_condiments_oils",227,["giấm balsamic Ý"],["giam den balsamic","giam balsamic y"],["white balsamic vinegar"],false],["ing_0421_sherry_vinegar","sherry vinegar","giấm rượu Sherry","sherry vinegar","sauces_condiments_oils",111,["giấm sherry"],["giam ruou sherry","giam sherry"],["sherry wine vinegar"],false],["ing_0422_coconut_milk","coconut milk","nước cốt dừa","coconut milk","sauces_condiments_oils",41,["sữa dừa","nước cốt dừa lon"],["nuoc cot dua","sua dua","nuoc cot dua lon"],["unsweetened coconut milk","canned unsweetened coconut milk"],false],["ing_0423_dry_white_wine","dry white wine","rượu vang trắng","dry white wine","sauces_condiments_oils",476,["vang trắng nấu ăn"],["ruou vang trang","vang trang nau an"],["white wine"],false],["ing_0424_dry_red_wine","dry red wine","rượu vang đỏ","dry red wine","sauces_condiments_oils",113,["vang đỏ nấu ăn"],["ruou vang do","vang do nau an"],["red wine"],false],["ing_0425_dry_sherry","dry sherry","rượu Sherry nấu ăn","dry sherry","sauces_condiments_oils",29,["rượu vang sherry"],["ruou sherry nau an","ruou vang sherry"],[],false],["ing_0426_dry_vermouth","dry vermouth","rượu Vermouth khô","dry vermouth","sauces_condiments_oils",29,["rượu mùi vermouth"],["ruou vermouth kho","ruou mui vermouth"],["sweet vermouth"],false],["ing_0427_vodka","vodka","rượu vodka","vodka","sauces_condiments_oils",78,[],["ruou vodka"],[],false],["ing_0428_white_rum","white rum","rượu rum trắng","white rum","sauces_condiments_oils",22,["rượu rum"],["ruou rum trang","ruou rum"],["dark rum","rum"],false],["ing_0429_bourbon","bourbon","rượu whisky Bourbon","bourbon","sauces_condiments_oils",94,["rượu bourbon"],["ruou whisky bourbon","ruou bourbon"],["whiskey","rye whiskey"],false],["ing_0430_brandy","brandy","rượu mạnh Brandy / Cognac","brandy","sauces_condiments_oils",68,["rượu brandy","rượu cognac"],["ruou manh brandy / cognac","ruou brandy","ruou cognac"],["cognac"],false],["ing_0431_gin","gin","rượu Gin","gin","sauces_condiments_oils",75,[],["ruou gin"],[],false],["ing_0432_campari","campari","rượu đắng Campari","campari","sauces_condiments_oils",38,[],["ruou dang campari"],["angostura bitters","orange bitters"],false],["ing_0433_st_germain","st-germain","rượu mùi St-Germain","st-germain","sauces_condiments_oils",7,[],["ruou mui st-germain"],["champagne"],false],["ing_0434_salt","salt","muối","salt","spices_seasonings",3031,["muối ăn","muối tinh"],["muoi","muoi an","muoi tinh"],["table salt","coarse salt"],false],["ing_0435_kosher_salt","kosher salt","muối kosher","kosher salt","spices_seasonings",4097,["muối hạt kosher"],["muoi kosher","muoi hat kosher"],["coarse kosher salt","diamond crystal kosher salt"],false],["ing_0436_sea_salt","sea salt","muối biển","sea salt","spices_seasonings",292,["muối hạt biển"],["muoi bien","muoi hat bien"],["fine sea salt","flaky sea salt","coarse sea salt","fleur de sel"],false],["ing_0437_flaky_sea_salt_such_as_maldon","flaky sea salt such as maldon","muối biển dạng vảy, như Maldon","flaky sea salt such as maldon","spices_seasonings",7,[],["muoi bien dang vay, nhu maldon"],[],false],["ing_0438_flaky_sea_salt_preferably_fleur_de_sel","flaky sea salt, preferably fleur de sel","muối biển dạng vảy, ưu tiên fleur de sel","flaky sea salt, preferably fleur de sel","spices_seasonings",1,[],["muoi bien dang vay, uu tien fleur de sel"],[],false],["ing_0439_pepper","pepper","tiêu","pepper","spices_seasonings",168,["hạt tiêu","hồ tiêu"],["tieu","hat tieu","ho tieu"],["ground pepper"],false],["ing_0440_black_pepper","black pepper","tiêu đen","black pepper","spices_seasonings",568,["hạt tiêu đen"],["tieu den","hat tieu den"],["black peppercorns","whole black peppercorns","cracked black pepper","peppercorns"],false],["ing_0441_ground_black_pepper","ground black pepper","tiêu đen xay","ground black pepper","spices_seasonings",2294,["tiêu xay","hạt tiêu xay","tiêu đen vừa xay"],["tieu den xay","tieu xay","hat tieu xay","tieu den vua xay"],["freshly ground black pepper"],false],["ing_0442_ground_white_pepper","ground white pepper","tiêu trắng xay","ground white pepper","spices_seasonings",82,["tiêu sọ","tiêu trắng","hạt tiêu sọ"],["tieu trang xay","tieu so","tieu trang","hat tieu so"],["white pepper","white peppercorns"],false],["ing_0443_sichuan_peppercorns","sichuan peppercorns","hoa tiêu Tứ Xuyên","sichuan peppercorns","spices_seasonings",19,["tiêu Tứ Xuyên","mắc khén / hoa tiêu"],["hoa tieu tu xuyen","tieu tu xuyen","mac khen / hoa tieu"],["sichuan pepper"],false],["ing_0444_red_pepper_flakes","red pepper flakes","ớt khô dạng mảnh (chili flakes)","red pepper flakes","spices_seasonings",420,["ớt bột mảnh","ớt mảnh khô"],["ot kho dang manh (chili flakes)","ot bot manh","ot manh kho"],["dried hot red-pepper flakes","dried hot red pepper flakes","hot red pepper flakes","hot red-pepper flakes","crushed red pepper","dried red pepper"],false],["ing_0445_chili_powder","chili powder","ớt bột","chili powder","spices_seasonings",122,["bột ớt","ớt bột mịn"],["ot bot","bot ot","ot bot min"],["ancho chile powder","red pepper","aleppo-style pepper","dried chile de árbol"],false],["ing_0446_cayenne_pepper","cayenne pepper","ớt bột cay Cayenne","cayenne pepper","spices_seasonings",337,["bột ớt cayenne","tiêu cayenne"],["ot bot cay cayenne","bot ot cayenne","tieu cayenne"],["cayenne"],false],["ing_0447_paprika","paprika","bột ớt ngọt Paprika","paprika","spices_seasonings",208,["ớt bột paprika"],["bot ot ngot paprika","ot bot paprika"],["sweet paprika"],false],["ing_0448_smoked_paprika","smoked paprika","bột ớt Paprika hun khói","smoked paprika","spices_seasonings",130,["paprika xông khói"],["bot ot paprika hun khoi","paprika xong khoi"],["hot smoked spanish paprika"],false],["ing_0449_ground_cumin","ground cumin","bột thì là Ai Cập (cumin)","ground cumin","spices_seasonings",504,["bột cumin","thì là Ai Cập xay"],["bot thi la ai cap (cumin)","bot cumin","thi la ai cap xay"],["cumin"],false],["ing_0450_cumin_seed","cumin seed","hạt thì là Ai Cập (cumin)","cumin seed","spices_seasonings",210,["hạt cumin"],["hat thi la ai cap (cumin)","hat cumin"],["cumin seeds"],false],["ing_0451_ground_coriander","ground coriander","bột hạt mùi (ngò)","ground coriander","spices_seasonings",190,["bột hạt ngò","hạt mùi xay"],["bot hat mui (ngo)","bot hat ngo","hat mui xay"],[],false],["ing_0452_coriander_seed","coriander seed","hạt mùi khô (hạt ngò)","coriander seed","spices_seasonings",205,["hạt ngò","hạt mùi"],["hat mui kho (hat ngo)","hat ngo","hat mui"],["coriander seeds"],false],["ing_0453_ground_turmeric","ground turmeric","bột nghệ","ground turmeric","spices_seasonings",148,["tinh bột nghệ"],["bot nghe","tinh bot nghe"],[],false],["ing_0454_curry_powder","curry powder","bột cà ri","curry powder","spices_seasonings",103,["gia vị cà ri"],["bot ca ri","gia vi ca ri"],["madras curry powder"],false],["ing_0455_garam_masala","garam masala","bột gia vị Ấn Độ Garam Masala","garam masala","spices_seasonings",42,["gia vị garam masala"],["bot gia vi an do garam masala","gia vi garam masala"],[],false],["ing_0456_chinese_five_spice_powder","chinese five-spice powder","bột ngũ vị hương","chinese five-spice powder","spices_seasonings",34,["ngũ vị hương","gói ngũ vị hương"],["bot ngu vi huong","ngu vi huong","goi ngu vi huong"],["five-spice powder"],false],["ing_0457_ground_cinnamon","ground cinnamon","bột quế","ground cinnamon","spices_seasonings",627,["quế xay"],["bot que","que xay"],[],false],["ing_0458_cinnamon","cinnamon","quế","cinnamon","spices_seasonings",175,["thanh quế","quế cây","vỏ quế"],["que","thanh que","que cay","vo que"],["cinnamon sticks","cinnamon stick"],false],["ing_0459_whole_star_anise","whole star anise","hoa hồi (đại hồi)","whole star anise","spices_seasonings",46,["hoa hồi","đại hồi","cánh hồi"],["hoa hoi (dai hoi)","hoa hoi","dai hoi","canh hoi"],["star anise","star anise pod"],false],["ing_0460_ground_cardamom","ground cardamom","bột thảo quả / bạch đậu khấu","ground cardamom","spices_seasonings",159,["bột bạch đậu khấu"],["bot thao qua / bach dau khau","bot bach dau khau"],["cardamom","cardamom pod"],false],["ing_0461_ground_nutmeg","ground nutmeg","bột nhục đậu khấu","ground nutmeg","spices_seasonings",166,["nhục đậu khấu","hạt nhục đậu khấu"],["bot nhuc dau khau","nhuc dau khau","hat nhuc dau khau"],["nutmeg"],false],["ing_0462_ground_clove","ground clove","bột đinh hương","ground clove","spices_seasonings",177,["đinh hương","nụ đinh hương"],["bot dinh huong","dinh huong","nu dinh huong"],["cloves","whole cloves"],false],["ing_0463_ground_allspice","ground allspice","bột tiêu Jamaica","ground allspice","spices_seasonings",175,["tiêu Jamaica"],["bot tieu jamaica","tieu jamaica"],["allspice berries","whole allspice"],false],["ing_0464_ground_ginger","ground ginger","bột gừng khô","ground ginger","spices_seasonings",226,["bột gừng"],["bot gung kho","bot gung"],[],false],["ing_0465_garlic_powder","garlic powder","bột tỏi","garlic powder","spices_seasonings",151,["tỏi bột"],["bot toi","toi bot"],["granulated garlic","garlic salt"],false],["ing_0466_onion_powder","onion powder","bột hành tây","onion powder","spices_seasonings",76,["bột hành"],["bot hanh tay","bot hanh"],[],false],["ing_0467_dry_mustard","dry mustard","bột mù tạt khô","dry mustard","spices_seasonings",41,["mù tạt bột"],["bot mu tat kho","mu tat bot"],["mustard powder"],false],["ing_0468_mustard_seed","mustard seed","hạt mù tạt","mustard seed","spices_seasonings",43,["hạt cải mù tạt"],["hat mu tat","hat cai mu tat"],["yellow mustard seed","brown mustard seed","mustard seeds"],false],["ing_0469_fennel_seed","fennel seed","hạt tiểu hồi","fennel seed","spices_seasonings",201,["hạt thì là Tây"],["hat tieu hoi","hat thi la tay"],["fennel seeds","ground fennel"],false],["ing_0470_caraway_seed","caraway seed","hạt caraway","caraway seed","spices_seasonings",63,["hạt thì là Ba Tư"],["hat caraway","hat thi la ba tu"],["caraway seeds"],false],["ing_0471_celery_seed","celery seed","hạt cần tây","celery seed","spices_seasonings",23,["muối cần tây"],["hat can tay","muoi can tay"],["celery salt"],false],["ing_0472_bay_leaf","bay leaf","lá nguyệt quế","bay leaf","spices_seasonings",413,["lá thơm nguyệt quế","lá bay leaf"],["la nguyet que","la thom nguyet que","la bay leaf"],["dried bay leaf","turkish bay leaf","bay leaves"],false],["ing_0473_dried_oregano","dried oregano","lá oregano khô","dried oregano","spices_seasonings",263,["kinh giới cay khô"],["la oregano kho","kinh gioi cay kho"],[],false],["ing_0474_dried_thyme","dried thyme","lá xạ hương khô (thyme khô)","dried thyme","spices_seasonings",90,["cỏ xạ hương khô"],["la xa huong kho (thyme kho)","co xa huong kho"],[],false],["ing_0475_dried_rosemary","dried rosemary","lá hương thảo khô","dried rosemary","spices_seasonings",21,["hương thảo khô"],["la huong thao kho","huong thao kho"],[],false],["ing_0476_dried_basil","dried basil","lá húng tây khô","dried basil","spices_seasonings",26,["basil khô"],["la hung tay kho","basil kho"],[],false],["ing_0477_saffron_threads","saffron threads","nhụy hoa nghệ tây (saffron)","saffron threads","spices_seasonings",58,["nhụy nghệ tây","nghệ tây"],["nhuy hoa nghe tay (saffron)","nhuy nghe tay","nghe tay"],["saffron"],false],["ing_0478_sumac","sumac","bột gia vị chua Sumac","sumac","spices_seasonings",25,["gia vị sumac"],["bot gia vi chua sumac","gia vi sumac"],[],false],["ing_0479_juniper_berries","juniper berries","quả bách xù khô","juniper berries","spices_seasonings",30,["hạt bách xù"],["qua bach xu kho","hat bach xu"],[],false],["ing_0480_pumpkin_pie_spice","pumpkin pie spice","bột gia vị bánh bí đỏ","pumpkin pie spice","spices_seasonings",15,["gia vị bánh bí ngô"],["bot gia vi banh bi do","gia vi banh bi ngo"],[],false],["ing_0481_chicken_broth","chicken broth","nước dùng gà","chicken broth","spices_seasonings",59,["nước hầm gà","nước luộc gà"],["nuoc dung ga","nuoc ham ga","nuoc luoc ga"],["chicken stock"],false],["ing_0482_low_salt_chicken_broth","low-salt chicken broth","nước dùng gà ít muối","low-salt chicken broth","spices_seasonings",280,["nước dùng gà giảm mặn"],["nuoc dung ga it muoi","nuoc dung ga giam man"],["low-sodium chicken broth","reduced-sodium chicken broth","canned low-salt chicken broth"],false],["ing_0483_beef_broth","beef broth","nước dùng bò","beef broth","spices_seasonings",43,["nước hầm xương bò"],["nuoc dung bo","nuoc ham xuong bo"],["beef stock","low-salt beef broth"],false],["ing_0484_vegetable_broth","vegetable broth","nước dùng rau củ","vegetable broth","spices_seasonings",49,["nước hầm rau củ chay"],["nuoc dung rau cu","nuoc ham rau cu chay"],["vegetable stock","low-sodium vegetable broth"],false],["ing_0485_clam_juice","clam juice","nước luộc nghêu đóng chai","clam juice","spices_seasonings",25,["nước dùng nghêu / hải sản"],["nuoc luoc ngheu dong chai","nuoc dung ngheu / hai san"],["bottled clam juice"],false],["ing_0486_dried_kombu","dried kombu","tảo bẹ khô Nhật (kombu)","dried kombu","spices_seasonings",9,["rong biển kombu nấu dashi","tảo bẹ kombu"],["tao be kho nhat (kombu)","rong bien kombu nau dashi","tao be kombu"],["kombu"],false],["ing_0487_water","water","nước","water","spices_seasonings",1483,["nước lọc","nước sạch"],["nuoc","nuoc loc","nuoc sach"],["warm water","hot water","boiling water","boiling-hot water","ice water","ice cubes","ice","club soda"],false],["ing_0488_sugar","sugar","đường","sugar","baking_sweeteners",2929,["đường trắng","đường kính"],["duong","duong trang","duong kinh"],["superfine sugar","superfine granulated sugar","raw sugar"],true],["ing_0489_granulated_sugar","granulated sugar","đường cát","granulated sugar","baking_sweeteners",528,["đường cát trắng"],["duong cat","duong cat trang"],[],false],["ing_0490_brown_sugar","brown sugar","đường nâu","brown sugar","baking_sweeteners",156,["đường đỏ","đường vàng"],["duong nau","duong do","duong vang"],["golden brown sugar"],false],["ing_0491_light_brown_sugar","light brown sugar","đường nâu nhạt","light brown sugar","baking_sweeteners",435,["đường nâu sáng màu"],["duong nau nhat","duong nau sang mau"],[],false],["ing_0492_dark_brown_sugar","dark brown sugar","đường nâu sẫm","dark brown sugar","baking_sweeteners",284,["đường đen Hàn Quốc"],["duong nau sam","duong den han quoc"],[],false],["ing_0493_powdered_sugar","powdered sugar","đường bột","powdered sugar","baking_sweeteners",349,["đường xay","đường icing"],["duong bot","duong xay","duong icing"],["confectioners' sugar","confectioners sugar","icing sugar"],false],["ing_0494_honey","honey","mật ong","honey","baking_sweeteners",695,["mật ong rừng","mật ong nguyên chất"],["mat ong","mat ong rung","mat ong nguyen chat"],["mild honey","pure honey"],false],["ing_0495_pure_maple_syrup","pure maple syrup","siro lá phong (maple syrup)","pure maple syrup","baking_sweeteners",160,["siro cây phong","siro phong"],["siro la phong (maple syrup)","siro cay phong","siro phong"],["maple syrup"],false],["ing_0496_agave_nectar","agave nectar","mật cây thùa (agave)","agave nectar","baking_sweeteners",31,["siro agave"],["mat cay thua (agave)","siro agave"],["agave syrup"],false],["ing_0497_molasses","molasses","mật mía đen (molasses)","molasses","baking_sweeteners",53,["mật mía","mật đường"],["mat mia den (molasses)","mat mia","mat duong"],["mild-flavored molasses"],false],["ing_0498_light_corn_syrup","light corn syrup","siro ngô (corn syrup)","light corn syrup","baking_sweeteners",163,["mạch nha ngô","siro bắp"],["siro ngo (corn syrup)","mach nha ngo","siro bap"],["corn syrup","dark corn syrup","simple syrup"],false],["ing_0499_baking_powder","baking powder","bột nở","baking powder","baking_sweeteners",853,["bột nở (baking powder)","bột nổi"],["bot no","bot no (baking powder)","bot noi"],[],false],["ing_0500_baking_soda","baking soda","muối nở","baking soda","baking_sweeteners",580,["muối nở (baking soda)","bột baking soda"],["muoi no","muoi no (baking soda)","bot baking soda"],[],false],["ing_0501_active_dry_yeast","active dry yeast","men nở khô (dry yeast)","active dry yeast","baking_sweeteners",99,["men làm bánh mì","men nở"],["men no kho (dry yeast)","men lam banh mi","men no"],["envelope active dry yeast","instant yeast","yeast"],false],["ing_0502_cream_of_tartar","cream of tartar","bột ổn định lòng trắng trứng (cream of tartar)","cream of tartar","baking_sweeteners",90,["bột tartar"],["bot on dinh long trang trung (cream of tartar)","bot tartar"],[],false],["ing_0503_unflavored_gelatin","unflavored gelatin","bột gelatin không mùi","unflavored gelatin","baking_sweeteners",69,["lá gelatin","bột gelatin"],["bot gelatin khong mui","la gelatin","bot gelatin"],["gelatin"],false],["ing_0504_vanilla","vanilla","vani","vanilla","baking_sweeteners",127,["hương vani"],["vani","huong vani"],[],false],["ing_0505_vanilla_extract","vanilla extract","chiết xuất vani","vanilla extract","baking_sweeteners",843,["tinh chất vani"],["chiet xuat vani","tinh chat vani"],[],false],["ing_0506_pure_vanilla_extract","pure vanilla extract","chiết xuất vani nguyên chất","pure vanilla extract","baking_sweeteners",301,[],["chiet xuat vani nguyen chat"],[],false],["ing_0507_vanilla_bean","vanilla bean","quả vani nguyên trái","vanilla bean","baking_sweeteners",201,["nhánh vani","sốt vani"],["qua vani nguyen trai","nhanh vani","sot vani"],["vanilla bean paste"],false],["ing_0508_almond_extract","almond extract","chiết xuất hạnh nhân","almond extract","baking_sweeteners",77,["tinh chất hạnh nhân"],["chiet xuat hanh nhan","tinh chat hanh nhan"],["pure almond extract"],false],["ing_0509_peppermint_extract","peppermint extract","chiết xuất bạc hà","peppermint extract","baking_sweeteners",21,["tinh chất bạc hà làm bánh"],["chiet xuat bac ha","tinh chat bac ha lam banh"],[],false],["ing_0510_rose_water","rose water","nước hoa hồng thực phẩm","rose water","baking_sweeteners",33,["nước cất hoa hồng","nước hoa cam"],["nuoc hoa hong thuc pham","nuoc cat hoa hong","nuoc hoa cam"],["orange flower water","orange blossom water"],false],["ing_0511_unsweetened_cocoa_powder","unsweetened cocoa powder","bột ca cao không đường","unsweetened cocoa powder","baking_sweeteners",196,["bột cacao","bột ca cao nguyên chất"],["bot ca cao khong duong","bot cacao","bot ca cao nguyen chat"],["natural unsweetened cocoa powder","cocoa powder","dutch-process cocoa powder"],false],["ing_0512_chocolate","chocolate","sô-cô-la","chocolate","baking_sweeteners",3,["socola"],["so-co-la","socola"],[],true],["ing_0513_dark_chocolate","dark chocolate","sô-cô-la đen","dark chocolate","baking_sweeteners",33,["socola đen"],["so-co-la den","socola den"],["unsweetened chocolate"],false],["ing_0514_bittersweet_chocolate","bittersweet chocolate","sô-cô-la đắng (bittersweet)","bittersweet chocolate","baking_sweeteners",142,["socola đắng 70%"],["so-co-la dang (bittersweet)","socola dang 70%"],["fine-quality bittersweet chocolate","bittersweet chocolate chips"],false],["ing_0515_semisweet_chocolate","semisweet chocolate","sô-cô-la bán ngọt","semisweet chocolate","baking_sweeteners",37,["sô-cô-la làm bánh"],["so-co-la ban ngot","so-co-la lam banh"],["semisweet chocolate chips"],false],["ing_0516_good_quality_semisweet_chocolate","good-quality semisweet chocolate","sô-cô-la bán ngọt chất lượng tốt","good-quality semisweet chocolate","baking_sweeteners",2,[],["so-co-la ban ngot chat luong tot"],[],false],["ing_0517_white_chocolate","white chocolate","sô-cô-la trắng","white chocolate","baking_sweeteners",21,["socola trắng"],["so-co-la trang","socola trang"],["high-quality white chocolate"],false],["ing_0518_instant_espresso_powder","instant espresso powder","bột cà phê espresso hòa tan","instant espresso powder","baking_sweeteners",32,["bột cà phê đen"],["bot ca phe espresso hoa tan","bot ca phe den"],["espresso powder"],false],["ing_0519_brewed_espresso","brewed espresso","cà phê espresso pha sẵn","brewed espresso","baking_sweeteners",2,["cà phê đen pha đậm"],["ca phe espresso pha san","ca phe den pha dam"],[],false],["ing_0520_pastry_cream","pastry cream","kem trứng làm bánh","pastry cream","baking_sweeteners",4,["kem su kem"],["kem trung lam banh","kem su kem"],[],false],["ing_0521_vegetable_shortening","vegetable shortening","mỡ thực vật làm bánh (shortening)","vegetable shortening","baking_sweeteners",34,["bơ thực vật shortening"],["mo thuc vat lam banh (shortening)","bo thuc vat shortening"],["shortening"],false],["ing_0522_crystallized_ginger","crystallized ginger","mứt gừng kết tinh","crystallized ginger","baking_sweeteners",58,["mứt gừng khô"],["mut gung ket tinh","mut gung kho"],["candied ginger"],false],["ing_0523_candied_orange_peel","candied orange peel","mứt vỏ cam","candied orange peel","baking_sweeteners",18,["vỏ cam sên đường"],["mut vo cam","vo cam sen duong"],[],false],["ing_0524_orange_marmalade","orange marmalade","mứt cam marmalade","orange marmalade","baking_sweeteners",18,["mứt vỏ cam dẻo"],["mut cam marmalade","mut vo cam deo"],[],false],["ing_0525_apricot_preserves","apricot preserves","mứt mơ","apricot preserves","baking_sweeteners",21,["mứt quả mơ"],["mut mo","mut qua mo"],["apricot jam"],false],["ing_0526_raspberry_jam","raspberry jam","mứt phúc bồn tử","raspberry jam","baking_sweeteners",12,["mứt dâu mâm xôi"],["mut phuc bon tu","mut dau mam xoi"],[],false]]);

const KNOWN_CATALOG_CANONICALS = new Set(["chicken","raw chicken","chicken breast","chicken breasts","boneless skinless chicken breast","skinless boneless chicken breast","skinless boneless chicken breast halves","boneless, skinless chicken breast","skinless, boneless chicken breast","skinless boneless chicken thigh","boneless skinless chicken thigh","boneless skinless chicken thighs","chicken thigh","chicken thighs","bone-in skin-on chicken thigh","skin-on, bone-in chicken thigh","bone-in, skin-on chicken thigh","chicken wing","chicken wings","chicken drumstick","chicken drumsticks","chicken legs","chicken leg","chicken tenders","chicken tender","chicken tenderloin","chicken livers","chicken liver","whole chicken","cooked chicken","shredded cooked chicken","ground chicken","minced chicken","ground beef","minced beef","ground beef chuck","lean ground beef chuck","beef chuck","chuck roast","beef chuck roast","boneless beef chuck","boneless beef chuck roast","ground sirloin","beef tenderloin","filet mignon","beef filet","flank steak","beef flank steak","skirt steak","beef skirt steak","sirloin steak","top sirloin steak","beef sirloin","rib-eye steak","ribeye steak","rib eye steak","new york strip steak","strip steak","beef brisket","flat-cut beef brisket","beef short ribs","short ribs","bone-in beef short ribs","boneless beef short ribs","corned beef","ground pork","minced pork","heo xay","ground pork shoulder","pork belly","skinless pork belly","pork ribs","pork spareribs","baby back ribs","pork tenderloin","pork tenderloins","boneless pork loin","pork loin","pork loin roast","pork shoulder","pork butt","boston butt","boneless pork shoulder","boneless pork butt","bone-in pork chops","pork chop","pork chops","bone-in pork chop","boneless pork loin chops","bacon","bacon slices","sliced bacon","thick-cut bacon","thick cut bacon","slab bacon","pancetta","prosciutto","thinly sliced prosciutto","ham","cooked ham","diced cooked ham","country ham","chinese sausage","lap xuong","chinese sausages","sweet italian sausage","italian sausage","mild italian sausage","hot italian sausage","spicy italian sausage","andouille sausage","andouille","chorizo","mexican chorizo","spanish chorizo","ground turkey","minced turkey","turkey","whole turkey","cooked turkey","ground lamb","minced lamb","boneless leg of lamb","leg of lamb","bone-in leg of lamb","rib lamb chops","lamb rack","rack of lamb","racks of lamb","lamb chops","lamb shanks","boneless lamb shoulder","lamb shoulder","bone-in lamb shoulder","duck","whole duck","duck breast","duck breasts","magret duck breast","duck legs","duck leg","ground veal","minced veal","shrimp","shrimps","raw shrimp","uncooked shrimp","prawns","prawn","shrimp peeled deveined","shrimp, peeled, deveined","peeled and deveined shrimp","shrimp , peeled, deveined","uncooked shrimp, peeled, deveined","shrimp in shell","shell-on shrimp","unpeeled shrimp","jumbo shrimp","large shrimp","extra-large shrimp","cooked shrimp","dried shrimp","squid","calamari","cleaned squid","octopus","baby octopus","salmon","fresh salmon","salmon fillet","salmon fillets","skinless salmon fillet","skinless salmon fillets","smoked salmon","thinly sliced smoked salmon","cod fillet","cod","cod fillets","skinless cod fillet","black cod fillet with skin","halibut fillet","halibut","halibut fillets","sea bass fillet with skin","sea bass","black sea bass","striped bass","smoked trout","trout","rainbow trout","tuna steak","tuna","ahi tuna","ahi tuna steak","tuna steaks","yellowfin tuna","tuna in olive oil","canned tuna","oil-packed tuna","swordfish steak","swordfish","swordfish steaks","snapper fillet","snapper","red snapper","red snapper fillet","catfish fillet","catfish","catfish fillets","tilapia fillet","tilapia","tilapia fillets","sardine","fresh sardines","sardines","anchovy fillet","anchovy","anchovies","anchovy fillets","oil-packed anchovy fillet","anchovy paste","sea scallop","scallop","scallops","sea scallops","bay scallops","littleneck clam","clam","clams","littleneck clams","manila clams","mussel","mussels","cultivated mussel","oyster","oysters","shucked oysters","lump crabmeat","crabmeat","crab meat","jumbo lump crabmeat","crab","live lobster","lobster","lobster tails","egg","eggs","whole egg","large egg","egg yolk","egg yolks","egg white","egg whites","hard-boiled egg","hard boiled egg","hard-boiled eggs","quail egg","quail eggs","firm tofu","firm bean curd","extra-firm tofu","extra firm tofu","silken tofu","soft tofu","tomato","tomatoes","ripe tomato","whole tomato","cherry tomato","cherry tomatoes","grape tomato","grape tomatoes","plum tomato","plum tomatoes","roma tomato","roma tomatoes","heirloom tomato","heirloom tomatoes","beefsteak tomato","beefsteak tomatoes","tomato in juice","whole tomato in juice","canned whole tomatoes","onion","onions","red onion","red onions","white onion","white onions","yellow onion","yellow onions","sweet onion","vidalia onion","pearl onion","pearl onions","pickled red onion","leek","leeks","carrot","carrots","baby carrot","baby carrots","potato","potatoes","russet potato","russet potatoes","baking potato","yukon gold potato","yukon gold potatoes","baby yukon gold potato","red potato","red potatoes","red-skinned potato","boiling potato","waxy potato","new potato","fingerling potato","sweet potato","sweet potatoes","red-skinned sweet potato","mushroom","mushrooms","white mushroom","button mushroom","button mushrooms","crimini mushroom","cremini mushroom","crimini mushrooms","cremini mushrooms","shiitake mushroom","shiitake mushrooms","fresh shiitake mushrooms","portobello mushroom","portobello mushrooms","portabella mushroom","dried porcini mushroom","dried porcini","dried wood ear mushroom","wood ear mushroom","black fungus","mixed mushroom","wild mushroom","assorted wild mushroom","mixed wild mushroom","spinach","spinach leaf","spinach leaves","fresh spinach","rau bina","baby spinach","baby spinach leaf","baby spinach leaves","frozen spinach","broccoli","broccoli floret","broccoli florets","broccolini","broccoli rabe","rapini","cauliflower","cauliflower floret","cauliflower florets","cabbage","green cabbage","red cabbage","purple cabbage","napa cabbage","chinese cabbage","savoy cabbage","bok choy","pak choi","baby bok choy","anghai bok choy","choy sum","yu choy","kale","tuscan kale","lacinato kale","curly kale","swiss chard","chard","rainbow chard","collard greens","collards","watercress","watercress sprig","arugula","baby arugula","arugula leaf","romaine lettuce","romaine","romaine heart","lettuce","lettuce leaf","iceberg lettuce","butter lettuce","bibb lettuce","boston lettuce","radicchio","belgian endive","endive","belgian endives","endives","escarole","frisée","cucumber","cucumbers","seedless cucumber","english hothouse cucumber","english cucumber","persian cucumber","persian cucumbers","kirby cucumber","zucchini","courgette","yellow squash","summer squash","butternut squash","cubes butternut squash","acorn squash","delicata squash","pumpkin","fresh pumpkin","canned pure pumpkin","pure pumpkin","pumpkin purée","canned solid-pack pumpkin","eggplant","eggplants","aubergine","italian eggplant","japanese eggplant","bell_pepper","bell pepper","bell peppers","red bell pepper","red bell peppers","green bell pepper","green bell peppers","yellow bell pepper","yellow bell peppers","orange bell pepper","orange bell peppers","roasted red bell_pepper","roasted red bell pepper","roasted red peppers","green bean","green beans","haricots verts","string beans","pea","peas","green peas","english peas","frozen pea","frozen peas","frozen petite peas","sugar snap pea","sugar snap peas","snap peas","snow pea","snow peas","chinese pea pods","bean sprouts","mung bean sprouts","bean sprout","okra","fresh okra","corn","ear of corn","ears of corn","sweet corn","ears corn","corn kernels","fresh corn kernels","frozen corn","frozen corn kernels","asparagus","asparagus spears","celery","celery ribs","celery rib","celery stalk","celery stalks","celery root","celeriac","fennel bulb","fennel","fennel bulbs","radish","radishes","red radish","daikon","daikon radish","turnip","turnips","baby turnip","beet","beets","red beet","beetroot","parsnips","parsnip","brussels sprouts","brussels sprout","artichokes","artichoke","baby artichokes","artichoke heart","marinated artichoke heart","garlic","garlic clove","garlic cloves","cloves garlic","shallot","shallots","green_onion","green onion","green onions","scallion","scallions","spring onion","spring onions","chives","fresh chives","ginger","fresh ginger","peeled fresh ginger","lemongrass","lemongrass stalks","turmeric","fresh turmeric","cilantro","cilantro leaf","fresh cilantro","coriander leaves","parsley","parsley leaf","fresh parsley","flat-leaf parsley","italian parsley","flat-leaf parsley leaf","italian parsley leaf","basil","basil leaf","fresh basil","thai basil","packaged basil leaf","mint","mint leaf","fresh mint","mint leaf plus sprig","dill","fresh dill","dill sprigs","rosemary","rosemary leaf","fresh rosemary","thyme","thyme leaf","fresh thyme","oregano","oregano leaf","fresh oregano","sage","sage leaf","fresh sage","tarragon","tarragon leaf","fresh tarragon","marjoram","fresh marjoram","assorted herbs","tender herbs such as dill or parsley","kaffir lime leaf","makrut lime leaf","lime leaves","curry leaf","fresh curry leaves","thai chile","thai chiles","bird chile","birds eye chili","jalapeño","jalapeno","jalapeño chile","jalapeño pepper","serrano chile","serrano","serrano pepper","poblano chile","poblano pepper","fresh poblano chile","red chile","fresno chile","red chili","horseradish","prepared horseradish","bottled horseradish","prepared white horseradish","lemon","lemons","lemon wedges","lemon juice","fresh lemon juice","squeezed lemon juice","juice of 1 lemon","juice of 1/2 lemon","lemon zest","lemon peel","grated lemon zest","zest of 1 lemon","preserved lemon","lime","limes","lime juice","squeezed lime juice","fresh lime juice","freshly squeezed lime juice","juice of 1 lime","lime zest","grated lime zest","lime peel","zest of 1 lime","lime wedge","lime wedges","orange","oranges","navel orange","blood orange","orange juice","squeezed orange juice","fresh orange juice","blood orange juice","orange zest","orange peel","zest of 1 orange","grated orange zest","grapefruit","pink grapefruit","grapefruit juice","pink grapefruit juice","grapefruit zest","apple","apples","gala apple","fuji apple","pink lady apple","golden delicious apple","granny smith apple","green apple","apple juice","apple cider","unfiltered apple cider","applesauce","unsweetened applesauce","banana","bananas","ripe banana","very ripe banana","strawberry","strawberries","hulled strawberry","fresh strawberries","blueberry","blueberries","fresh blueberries","raspberry","raspberries","frozen raspberry","blackberry","blackberries","cranberry","cranberries","fresh cranberries","dried cranberry","dried cranberries","craisins","cherry","cherries","sweet cherries","maraschino cherry","dried cherry","dried tart cherry","dried cherries","peach","peaches","ripe peach","nectarines","nectarine","plum","plums","red plum","apricot","apricots","dried apricot","dried california apricot","dried apricots","mango","mangoes","ripe mango","pineapple","fresh pineapple","pineapple juice","avocado","avocados","ripe avocado","coconut","fresh coconut","coconut water","unsweetened coconut","unsweetened coconut flakes","unsweetened dried coconut","sweetened flaked coconut","sweetened coconut","pear","pears","bosc pear","asian pear","anjou pear","seedless red grape","grapes","red seedless grape","green grapes","raisin","raisins","golden raisin","golden raisins","dried currant","dried currants","currants","date","dates","medjool date","pitted date","pitted medjool date","fig","figs","fresh figs","dried fig","dried figs","pomegranate seed","pomegranate","pomegranate arils","pomegranate juice","rhubarb","fresh rhubarb","huckleberries","huckleberry","milk","whole milk","sweetened condensed milk","condensed milk","buttermilk","well-shaken buttermilk","heavy cream","heavy whipping cream","whipping cream","whipped cream","sweetened whipped cream","half-and-half","half and half","sour cream","crème fraîche","creme fraiche","plain yogurt","plain whole-milk yogurt","yogurt","plain greek yogurt","plain whole-milk greek yogurt","greek yogurt","butter","unsalted butter","salted butter","salted butter, cubed","cheese","cheeses","cream cheese","philadelphia-brand cream cheese","parmesan cheese","parmesan","parmigiano-reggiano","parmigiano reggiano","mozzarella cheese","mozzarella","fresh mozzarella","cheddar cheese","cheddar","sharp cheddar","sharp cheddar cheese","white cheddar","goat cheese","chèvre","chevre","soft goat cheese","feta cheese","feta","crumbled feta","ricotta cheese","ricotta","whole-milk ricotta","mascarpone cheese","mascarpone","gruyère cheese","gruyere","gruyère","gruyere cheese","pecorino romano cheese","pecorino","pecorino romano","fontina cheese","fontina","monterey jack cheese","monterey jack","burrata cheese","burrata","vanilla ice cream","ice cream","cooked rice","cooked white rice","steamed rice","long-grain white rice","white rice","long-grain rice","jasmine rice","basmati rice","arborio rice","carnaroli rice","short-grain rice","sushi rice","short-grain brown rice","wild rice","egg noodle","egg noodles","dried wide egg noodle","spaghetti","linguine","fettuccine","dried egg fettuccine","penne","penne rigate","rigatoni","orzo","pasta","macaroni","elbow macaroni","soba noodle","soba noodles","buckwheat noodles","bread","breads","white bread","firm white sandwich bread","sandwich bread","baguette","french bread","country-style bread","crusty bread","sourdough bread","ciabatta bread","loaf of stale french bread","hamburger buns","burger buns","bread crumbs","fine dry bread crumbs","coarse bread crumbs","breadcrumb","coarse breadcrumb","fine bread crumbs","plain breadcrumb","panko","panko bread crumbs","panko breadcrumb","corn tortilla","corn tortillas","flour tortilla","flour tortillas","tortilla chips","potato chips","frozen puff pastry","puff pastry","puff pastry sheets","flour","all-purpose flour","all purpose flour","unbleached all-purpose flour","unbleached all purpose flour","self-rising flour","bread flour","cake flour","pastry flour","whole wheat flour","whole-wheat flour","rice flour","white rice flour","chickpea flour","besan","gram flour","cornstarch","corn starch","potato starch","cornmeal","yellow cornmeal","polenta","old-fashioned oats","rolled oats","old-fashioned rolled oats","oats","quinoa","cooked quinoa","couscous","israeli couscous","bulgur","bulgur wheat","farro","pearl barley","barley","graham cracker crumbs","graham crackers","matzo meal","black bean","black beans","canned black beans","white bean","white beans","navy beans","cannellini bean","cannellini beans","pinto bean","pinto beans","chickpea","chickpeas","garbanzo bean","garbanzo beans","canned chickpea","dried chickpea","red lentil","lentils","brown lentils","green lentils","french green lentils","black-eyed pea","black-eyed peas","frozen shelled edamame","edamame","almond","almonds","whole almond","blanched almond","slivered almond","sliced almonds","walnut","walnuts","walnut halves","walnut pieces","pecan","pecans","pecan halves","pistachio","pistachios","raw pistachio","shelled pistachios","hazelnut","hazelnuts","blanched hazelnut","pine nuts","pine nut","pignoli","peanut","peanuts","roasted peanut","salted roasted peanut","salted dry-roasted peanut","cashew","cashews","raw cashews","roasted cashews","sesame seed","sesame seeds","toasted sesame seeds","black sesame seed","black sesame seeds","pumpkin seed","pepitas","raw pumpkin seed","shelled pumpkin seed","chia seed","chia seeds","poppy seed","poppy seeds","fish sauce","asian fish sauce","nam pla","nuoc mam","soy sauce","shoyu","tamari","low-sodium soy sauce","reduced-sodium soy sauce","light soy sauce","dark soy sauce","oyster sauce","hoisin sauce","hoisin","sriracha","sriracha sauce","chili-garlic sauce","chili garlic sauce","sambal oelek","gochujang","korean hot pepper paste","kimchi","napa cabbage kimchi","white miso","miso","white miso paste","red miso","yellow miso","mirin","sweetened mirin","sake","japanese sake","tahini","tahini paste","peanut butter","creamy peanut butter","smooth peanut butter","creamy natural peanut butter","mayonnaise","mayo","good-quality mayonnaise","ketchup","tomato ketchup","tomato paste","double-concentrated tomato paste","tomato sauce","canned tomato sauce","dijon mustard","mustard","whole-grain mustard","whole grain mustard","grainy mustard","whole grain dijon mustard","worcestershire sauce","hot sauce","hot pepper sauce","tabasco","frank's redhot","harissa paste","harissa","caper","capers","drained capers","cornichons","dill pickles","pickles","tamarind","tamarind concentrate","tamarind paste","tamarind pulp","me chua","pomegranate molasses","vegetable oil","oil","cooking oil","neutral oil","olive oil","extra-virgin olive oil","extra virgin olive oil","canola oil","peanut oil","corn oil","grapeseed oil","coconut oil","virgin coconut oil","sesame oil","asian sesame oil","toasted sesame oil","dark sesame oil","distilled white vinegar","white vinegar","rice vinegar","unseasoned rice vinegar","seasoned rice vinegar","rice wine vinegar","apple cider vinegar","cider vinegar","red wine vinegar","red-wine vinegar","white wine vinegar","white-wine vinegar","champagne vinegar","balsamic vinegar","white balsamic vinegar","sherry vinegar","sherry wine vinegar","coconut milk","unsweetened coconut milk","canned unsweetened coconut milk","dry white wine","white wine","dry red wine","red wine","dry sherry","dry vermouth","sweet vermouth","vodka","white rum","dark rum","rum","bourbon","whiskey","rye whiskey","brandy","cognac","gin","campari","angostura bitters","orange bitters","st-germain","champagne","salt","table salt","coarse salt","kosher salt","coarse kosher salt","diamond crystal kosher salt","sea salt","fine sea salt","flaky sea salt","coarse sea salt","fleur de sel","flaky sea salt such as maldon","flaky sea salt, preferably fleur de sel","pepper","ground pepper","black pepper","black peppercorns","whole black peppercorns","cracked black pepper","peppercorns","ground black pepper","freshly ground black pepper","ground white pepper","white pepper","white peppercorns","sichuan peppercorns","sichuan pepper","red pepper flakes","dried hot red-pepper flakes","dried hot red pepper flakes","hot red pepper flakes","hot red-pepper flakes","crushed red pepper","dried red pepper","chili powder","ancho chile powder","red pepper","aleppo-style pepper","dried chile de árbol","cayenne pepper","cayenne","paprika","sweet paprika","smoked paprika","hot smoked spanish paprika","ground cumin","cumin","cumin seed","cumin seeds","ground coriander","coriander seed","coriander seeds","ground turmeric","curry powder","madras curry powder","garam masala","chinese five-spice powder","five-spice powder","ground cinnamon","cinnamon","cinnamon sticks","cinnamon stick","whole star anise","star anise","star anise pod","ground cardamom","cardamom","cardamom pod","ground nutmeg","nutmeg","ground clove","cloves","whole cloves","ground allspice","allspice berries","whole allspice","ground ginger","garlic powder","granulated garlic","garlic salt","onion powder","dry mustard","mustard powder","mustard seed","yellow mustard seed","brown mustard seed","mustard seeds","fennel seed","fennel seeds","ground fennel","caraway seed","caraway seeds","celery seed","celery salt","bay leaf","dried bay leaf","turkish bay leaf","bay leaves","dried oregano","dried thyme","dried rosemary","dried basil","saffron threads","saffron","sumac","juniper berries","pumpkin pie spice","chicken broth","chicken stock","low-salt chicken broth","low-sodium chicken broth","reduced-sodium chicken broth","canned low-salt chicken broth","beef broth","beef stock","low-salt beef broth","vegetable broth","vegetable stock","low-sodium vegetable broth","clam juice","bottled clam juice","dried kombu","kombu","water","warm water","hot water","boiling water","boiling-hot water","ice water","ice cubes","ice","club soda","sugar","superfine sugar","superfine granulated sugar","raw sugar","granulated sugar","brown sugar","golden brown sugar","light brown sugar","dark brown sugar","powdered sugar","confectioners' sugar","confectioners sugar","icing sugar","honey","mild honey","pure honey","pure maple syrup","maple syrup","agave nectar","agave syrup","molasses","mild-flavored molasses","light corn syrup","corn syrup","dark corn syrup","simple syrup","baking powder","baking soda","active dry yeast","envelope active dry yeast","instant yeast","yeast","cream of tartar","unflavored gelatin","gelatin","vanilla","vanilla extract","pure vanilla extract","vanilla bean","vanilla bean paste","almond extract","pure almond extract","peppermint extract","rose water","orange flower water","orange blossom water","unsweetened cocoa powder","natural unsweetened cocoa powder","cocoa powder","dutch-process cocoa powder","chocolate","dark chocolate","unsweetened chocolate","bittersweet chocolate","fine-quality bittersweet chocolate","bittersweet chocolate chips","semisweet chocolate","semisweet chocolate chips","good-quality semisweet chocolate","white chocolate","high-quality white chocolate","instant espresso powder","espresso powder","brewed espresso","pastry cream","vegetable shortening","shortening","crystallized ginger","candied ginger","candied orange peel","orange marmalade","apricot preserves","apricot jam","raspberry jam"]);

const AMBIGUOUS_CONCEPT_DEFS = Object.freeze({"beef":{"concept_id":"amb_beef","canonical_concept":"beef","display_name_vi":"thịt bò (chưa rõ phần cắt)","display_name_en":"beef (unspecified cut)","triggers":["thịt bò","thit bo","beef","beef meat","thịt bò tươi","thịt bò thái lát","bò thái lát"],"mapping_status":"AMBIGUOUS","reason":"GENERIC_MEAT_CUT_UNSPECIFIED","recommendable":false,"warning_vi":"Lưu ý: “Thịt bò” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa sang bò xay hay bắp bò (hãy chọn phần thịt cụ thể bên dưới nếu biết).","warning_en":"Note: \"Beef\" is a generic meat name without a specific cut. Please select a specific cut below if known.","disambiguation_options":[{"canonical_name":"ground beef","display_name_vi":"thịt bò xay","display_name_en":"ground beef"},{"canonical_name":"beef chuck","display_name_vi":"thịt nạc vai bò","display_name_en":"beef chuck"},{"canonical_name":"beef tenderloin","display_name_vi":"thăn nội bò","display_name_en":"beef tenderloin"},{"canonical_name":"flank steak","display_name_vi":"thăn bụng bò","display_name_en":"flank steak"},{"canonical_name":"sirloin steak","display_name_vi":"thăn ngoại bò","display_name_en":"sirloin steak"},{"canonical_name":"beef brisket","display_name_vi":"ức bò / gầu bò","display_name_en":"beef brisket"},{"canonical_name":"beef short ribs","display_name_vi":"sườn non bò","display_name_en":"beef short ribs"},{"canonical_name":"beef broth","display_name_vi":"nước dùng bò","display_name_en":"beef broth"}]},"pork":{"concept_id":"amb_pork","canonical_concept":"thịt heo","backend_concept":"pork","display_name_vi":"thịt heo / thịt lợn (chưa rõ phần cắt)","display_name_en":"pork (unspecified cut)","triggers":["thịt heo","thit heo","thịt lợn","thit lon","pork","pork meat","thịt heo tươi","thịt lợn tươi"],"mapping_status":"AMBIGUOUS","reason":"GENERIC_MEAT_CUT_UNSPECIFIED","recommendable":false,"warning_vi":"Lưu ý: “Thịt heo / thịt lợn” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa (hãy chọn phần thịt cụ thể như “thịt heo xay”, “thịt ba chỉ”, “sườn heo” nếu biết).","warning_en":"Note: \"Pork\" is a generic meat name without a specific cut. Please select a specific cut below if known.","disambiguation_options":[{"canonical_name":"ground pork","display_name_vi":"thịt heo xay","display_name_en":"ground pork"},{"canonical_name":"pork belly","display_name_vi":"thịt ba chỉ","display_name_en":"pork belly"},{"canonical_name":"pork ribs","display_name_vi":"sườn heo","display_name_en":"pork ribs"},{"canonical_name":"pork tenderloin","display_name_vi":"thăn nội heo","display_name_en":"pork tenderloin"},{"canonical_name":"pork shoulder","display_name_vi":"thịt nạc vai heo","display_name_en":"pork shoulder"},{"canonical_name":"bone-in pork chops","display_name_vi":"sườn cốt lết heo","display_name_en":"bone-in pork chops"},{"canonical_name":"bacon","display_name_vi":"thịt xông khói","display_name_en":"bacon"},{"canonical_name":"ham","display_name_vi":"giăm bông","display_name_en":"ham"}]},"chili":{"concept_id":"amb_chili","canonical_concept":null,"backend_concept":"chili","display_name_vi":"ớt (chưa rõ loại ớt)","display_name_en":"chili / pepper (unspecified variety)","triggers":["ớt","ot","quả ớt","qua ot","trái ớt","trai ot","chili","chile","chilli"],"mapping_status":"AMBIGUOUS","reason":"NO_CANONICAL_RECIPE_TOKEN","recommendable":false,"warning_vi":"Lưu ý: “Ớt” chung chưa rõ loại (ớt cay hay ớt chuông ngọt). Hệ thống không tự gán bừa; hãy chọn loại ớt cụ thể bên dưới nếu biết:","warning_en":"Note: Generic \"chili/pepper\" is ambiguous. Please select a specific variety below:","disambiguation_options":[{"canonical_name":"thai chile","display_name_vi":"ớt hiểm","display_name_en":"thai chile"},{"canonical_name":"bell_pepper","display_name_vi":"ớt chuông","display_name_en":"bell pepper"},{"canonical_name":"red bell pepper","display_name_vi":"ớt chuông đỏ","display_name_en":"red bell pepper"},{"canonical_name":"green bell pepper","display_name_vi":"ớt chuông xanh","display_name_en":"green bell pepper"},{"canonical_name":"yellow bell pepper","display_name_vi":"ớt chuông vàng","display_name_en":"yellow bell pepper"},{"canonical_name":"jalapeño","display_name_vi":"ớt jalapeño","display_name_en":"jalapeño"},{"canonical_name":"serrano chile","display_name_vi":"ớt serrano","display_name_en":"serrano chile"},{"canonical_name":"chili powder","display_name_vi":"ớt bột","display_name_en":"chili powder"},{"canonical_name":"red pepper flakes","display_name_vi":"ớt khô dạng mảnh","display_name_en":"red pepper flakes"}]},"tofu":{"concept_id":"amb_tofu","canonical_concept":"tofu","backend_concept":"tofu","display_name_vi":"đậu hũ / đậu phụ (chưa rõ loại)","display_name_en":"tofu (unspecified firmness)","triggers":["đậu hũ","dau hu","đậu phụ","dau phu","tofu","đậu hũ trắng","đậu phụ trắng","dau hu trang","dau phu trang"],"mapping_status":"AMBIGUOUS","reason":"GENERIC_VARIANT_UNSPECIFIED","recommendable":false,"warning_vi":"Lưu ý: “Đậu hũ / đậu phụ” chưa có mục chung duy nhất trong bộ công thức tiếng Anh; hệ thống giữ nguyên và gợi ý bạn chọn loại đậu phụ cụ thể bên dưới:","warning_en":"Note: Generic \"tofu\" requires a specific variety in the catalog; please select one below:","disambiguation_options":[{"canonical_name":"firm tofu","display_name_vi":"đậu phụ cứng","display_name_en":"firm tofu"},{"canonical_name":"silken tofu","display_name_vi":"đậu hũ non","display_name_en":"silken tofu"},{"canonical_name":"extra-firm tofu","display_name_vi":"đậu phụ ép chắc","display_name_en":"extra-firm tofu"}]}});

const EXTRA_DISAMBIGUATION_OPTIONS = Object.freeze({
  fish: [
    {"canonical_name":"salmon","display_name_vi":"cá hồi","display_name_en":"salmon"},
    {"canonical_name":"cod fillet","display_name_vi":"cá tuyết","display_name_en":"cod fillet"},
    {"canonical_name":"tuna steak","display_name_vi":"cá ngừ tươi","display_name_en":"tuna steak"},
    {"canonical_name":"tilapia fillet","display_name_vi":"phi lê cá rô phi","display_name_en":"tilapia fillet"},
    {"canonical_name":"sea bass fillet with skin","display_name_vi":"cá vược biển (cá chẽm)","display_name_en":"sea bass fillet with skin"},
    {"canonical_name":"snapper fillet","display_name_vi":"cá hồng","display_name_en":"snapper fillet"},
    {"canonical_name":"catfish fillet","display_name_vi":"phi lê cá da trơn","display_name_en":"catfish fillet"},
  ],
  onion_generic: [
    {"canonical_name":"onion","display_name_vi":"hành tây","display_name_en":"onion"},
    {"canonical_name":"green_onion","display_name_vi":"hành lá","display_name_en":"green onion"},
    {"canonical_name":"shallot","display_name_vi":"hành tím","display_name_en":"shallot"},
    {"canonical_name":"red onion","display_name_vi":"hành tây tím","display_name_en":"red onion"},
    {"canonical_name":"white onion","display_name_vi":"hành tây trắng","display_name_en":"white onion"},
    {"canonical_name":"leek","display_name_vi":"tỏi tây","display_name_en":"leek"},
  ],
});

const GENERIC_AMBIGUOUS_CONCEPTS = Object.freeze({
  "thịt bò": {canonical: "beef", conceptKey: "beef", warning: "Lưu ý: “Thịt bò” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa sang bò xay hay bắp bò (hãy nhập cụ thể như “thịt bò xay” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.beef.disambiguation_options},
  "thit bo": {canonical: "beef", conceptKey: "beef", warning: "Lưu ý: “Thịt bò” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa sang bò xay hay bắp bò (hãy nhập cụ thể như “thịt bò xay” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.beef.disambiguation_options},
  "beef": {canonical: "beef", conceptKey: "beef", warning: "Lưu ý: “Thịt bò” (beef) là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa sang phần cắt cụ thể.", options: AMBIGUOUS_CONCEPT_DEFS.beef.disambiguation_options},
  "thịt heo": {canonical: "thịt heo", conceptKey: "pork", warning: "Lưu ý: “Thịt heo” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa (hãy nhập cụ thể như “thịt heo băm”, “thịt ba rọi”, “sườn heo” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.pork.disambiguation_options},
  "thit heo": {canonical: "thịt heo", conceptKey: "pork", warning: "Lưu ý: “Thịt heo” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa (hãy nhập cụ thể như “thịt heo băm”, “thịt ba rọi”, “sườn heo” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.pork.disambiguation_options},
  "thịt lợn": {canonical: "thịt heo", conceptKey: "pork", warning: "Lưu ý: “Thịt lợn / thịt heo” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa (hãy nhập cụ thể như “thịt heo băm”, “thịt ba rọi”, “sườn heo” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.pork.disambiguation_options},
  "thit lon": {canonical: "thịt heo", conceptKey: "pork", warning: "Lưu ý: “Thịt lợn / thịt heo” là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa (hãy nhập cụ thể như “thịt heo băm”, “thịt ba rọi”, “sườn heo” nếu biết).", options: AMBIGUOUS_CONCEPT_DEFS.pork.disambiguation_options},
  "pork": {canonical: "thịt heo", conceptKey: "pork", warning: "Lưu ý: “Thịt heo” (pork) là tên chung chưa rõ phần cắt. Hệ thống giữ nguyên trong tủ và không tự đoán bừa.", options: AMBIGUOUS_CONCEPT_DEFS.pork.disambiguation_options},
  "đậu hũ": {canonical: "tofu", conceptKey: "tofu", warning: "Lưu ý: “Đậu hũ / đậu phụ” chưa có mục tương ứng trực tiếp trong bộ công thức tiếng Anh; hệ thống giữ nguyên và cảnh báo rõ thay vì gán sai.", options: AMBIGUOUS_CONCEPT_DEFS.tofu.disambiguation_options},
  "dau hu": {canonical: "tofu", conceptKey: "tofu", warning: "Lưu ý: “Đậu hũ / đậu phụ” chưa có mục tương ứng trực tiếp trong bộ công thức tiếng Anh; hệ thống giữ nguyên và cảnh báo rõ thay vì gán sai.", options: AMBIGUOUS_CONCEPT_DEFS.tofu.disambiguation_options},
  "đậu phụ": {canonical: "tofu", conceptKey: "tofu", warning: "Lưu ý: “Đậu hũ / đậu phụ” chưa có mục tương ứng trực tiếp trong bộ công thức tiếng Anh; hệ thống giữ nguyên và cảnh báo rõ thay vì gán sai.", options: AMBIGUOUS_CONCEPT_DEFS.tofu.disambiguation_options},
  "dau phu": {canonical: "tofu", conceptKey: "tofu", warning: "Lưu ý: “Đậu hũ / đậu phụ” chưa có mục tương ứng trực tiếp trong bộ công thức tiếng Anh; hệ thống giữ nguyên và cảnh báo rõ thay vì gán sai.", options: AMBIGUOUS_CONCEPT_DEFS.tofu.disambiguation_options},
  "tofu": {canonical: "tofu", conceptKey: "tofu", warning: "Lưu ý: “Đậu hũ / đậu phụ” (tofu) cần chọn loại cụ thể để đối chiếu công thức chính xác hơn.", options: AMBIGUOUS_CONCEPT_DEFS.tofu.disambiguation_options},
  "ớt": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” chung chưa rõ loại (ớt cay hay ớt chuông ngọt). Hệ thống giữ nguyên trong danh sách và không tự gán bừa; hãy chọn loại ớt cụ thể bên dưới nếu biết.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "ot": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” chung chưa rõ loại (ớt cay hay ớt chuông ngọt). Hệ thống giữ nguyên trong danh sách và không tự gán bừa; hãy chọn loại ớt cụ thể bên dưới nếu biết.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "quả ớt": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” chung chưa rõ loại (ớt cay hay ớt chuông ngọt). Hệ thống giữ nguyên trong danh sách và không tự gán bừa; hãy chọn loại ớt cụ thể bên dưới nếu biết.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "qua ot": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” chung chưa rõ loại (ớt cay hay ớt chuông ngọt). Hệ thống giữ nguyên trong danh sách và không tự gán bừa; hãy chọn loại ớt cụ thể bên dưới nếu biết.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "chili": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” (chili) chưa rõ loại. Hãy chọn loại ớt cụ thể như ớt hiểm hoặc ớt chuông đỏ.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "chile": {canonical: null, conceptKey: "chili", warning: "Lưu ý: “Ớt” (chile) chưa rõ loại. Hãy chọn loại ớt cụ thể như ớt hiểm hoặc ớt chuông đỏ.", options: AMBIGUOUS_CONCEPT_DEFS.chili.disambiguation_options},
  "cá": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Cá” là tên chung chưa rõ loại cá cụ thể. Hệ thống giữ nguyên và không tự ép sang một loại cá bất kỳ; hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "ca": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Cá” là tên chung chưa rõ loại cá cụ thể. Hệ thống giữ nguyên và không tự ép sang một loại cá bất kỳ; hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "thịt cá": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Thịt cá” là tên chung chưa rõ loại cá cụ thể. Hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "thit ca": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Thịt cá” là tên chung chưa rõ loại cá cụ thể. Hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "cá tươi": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Cá tươi” là tên chung chưa rõ loại cá cụ thể. Hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "ca tuoi": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Cá tươi” là tên chung chưa rõ loại cá cụ thể. Hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "fish": {canonical: "cá", conceptKey: "fish", warning: "Lưu ý: “Cá” (fish) là tên chung chưa rõ loại cá cụ thể. Hãy chọn loại cá cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.fish},
  "hành": {canonical: "hành", conceptKey: "onion_generic", warning: "Lưu ý: “Hành” chưa rõ loại cụ thể (hành tây, hành lá hay hành tím). Hệ thống giữ nguyên và không tự đoán bừa; hãy chọn loại hành cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.onion_generic},
  "hanh": {canonical: "hành", conceptKey: "onion_generic", warning: "Lưu ý: “Hành” chưa rõ loại cụ thể (hành tây, hành lá hay hành tím). Hệ thống giữ nguyên và không tự đoán bừa; hãy chọn loại hành cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.onion_generic},
  "củ hành": {canonical: "hành", conceptKey: "onion_generic", warning: "Lưu ý: “Củ hành” chưa rõ loại cụ thể (hành tây hay hành tím). Hệ thống giữ nguyên và không tự đoán bừa; hãy chọn loại cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.onion_generic},
  "cu hanh": {canonical: "hành", conceptKey: "onion_generic", warning: "Lưu ý: “Củ hành” chưa rõ loại cụ thể (hành tây hay hành tím). Hệ thống giữ nguyên và không tự đoán bừa; hãy chọn loại cụ thể bên dưới nếu biết.", options: EXTRA_DISAMBIGUATION_OPTIONS.onion_generic},
});

function stripVietnameseDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rebuildDiacriticFreeAliases() {
  diacriticFreeAliases = {};
  for (const [k, v] of Object.entries(localizationData.manual_aliases || {})) {
    const plain = stripVietnameseDiacritics(k);
    if (plain && !diacriticFreeAliases[plain]) diacriticFreeAliases[plain] = v;
  }
  for (const [k, v] of Object.entries(EXTRA_VI_ALIASES)) {
    const plain = stripVietnameseDiacritics(k);
    if (plain && !diacriticFreeAliases[plain]) diacriticFreeAliases[plain] = v;
  }
}
rebuildDiacriticFreeAliases();

function displayIngredient(name) {
  if (currentLocale === 'en') return name.replaceAll('_', ' ');
  const canonical = canonicalInput(name);
  const found = localizationData.ingredients[name] || localizationData.ingredients[canonical] ||
    EXTRA_VI_DISPLAY[name] || EXTRA_VI_DISPLAY[canonical];
  if (found) return found;
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(name)) return name;
  return `[EN: ${name.replaceAll('_',' ')}]`;
}
function displayRecipe(recipeName, recipeId) {
  if (currentLocale === 'en') return recipeName;
  const byId = displayCatalog.recipes[String(recipeId)];
  const meta = (byId?.source_name === recipeName ? byId : null) || displayTitlesByName[recipeName];
  return localizationData.recipe_titles[recipeName] || meta?.title || recipeName;
}
function normalizedInput(name) {
  return String(name || "").normalize("NFC").trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}
function canonicalInput(name) {
  const key = normalizedInput(name);
  if (!key) return "";
  if (GENERIC_AMBIGUOUS_CONCEPTS[key]?.canonical) return GENERIC_AMBIGUOUS_CONCEPTS[key].canonical;
  if (localizationData.manual_aliases[key]) return localizationData.manual_aliases[key];
  if (EXTRA_VI_ALIASES[key]) return EXTRA_VI_ALIASES[key];
  const ascii = stripVietnameseDiacritics(key);
  if (GENERIC_AMBIGUOUS_CONCEPTS[ascii]?.canonical) return GENERIC_AMBIGUOUS_CONCEPTS[ascii].canonical;
  if (EXTRA_VI_ALIASES[ascii]) return EXTRA_VI_ALIASES[ascii];
  if (diacriticFreeAliases[ascii]) return diacriticFreeAliases[ascii];
  return key;
}

const QUANTITY_PREFIX_RE = new RegExp(
  "^(\\d+(?:\\s+\\d+/\\d+|/\\d+|[.,]\\d+)?(?:\\s*(?:-|\u2013|to)\\s*\\d+(?:[.,]\\d+)?)?" +
  "(?:\\s*(?:quả|qua|trái|trai|củ|cu|nhánh|nhanh|tép|tep|cây|cay|bó|bo|bát|bat|chén|chen|miếng|mieng|lát|lat|khúc|khuc|bắp|bap|con|hộp|hop|gói|goi|bịch|bich|lon|chai|lọ|lo|muỗng canh|muỗng cà phê|thìa canh|thìa cà phê|muỗng|thìa|grams?|gr|g|kg|ml|lít|lit|l|cups?|tbsps?|tsps?|oz|lbs?))?)" +
  "\\s+(?:of\\s+)?(.+)$",
  "i"
);

function parseManualInputSegment(segment) {
  const trimmed = String(segment || "").normalize("NFC").trim();
  if (!trimmed) return null;
  let quantity = "";
  let foodPart = trimmed;
  const match = QUANTITY_PREFIX_RE.exec(trimmed);
  if (match && match[2]?.trim()) {
    quantity = match[1].trim();
    foodPart = match[2].trim();
  }
  const rawKey = normalizedInput(foodPart);
  const asciiKey = stripVietnameseDiacritics(foodPart);
  const ambiguous = GENERIC_AMBIGUOUS_CONCEPTS[rawKey] || GENERIC_AMBIGUOUS_CONCEPTS[asciiKey] || null;
  const canonical = ambiguous ? (ambiguous.canonical || foodPart) : canonicalInput(foodPart);
  const isKnown = Boolean(
    !ambiguous && (
      localizationData.manual_aliases[rawKey] ||
      localizationData.ingredients[canonical] ||
      EXTRA_VI_ALIASES[rawKey] ||
      EXTRA_VI_ALIASES[asciiKey] ||
      diacriticFreeAliases[asciiKey] ||
      EXTRA_VI_DISPLAY[canonical] ||
      KNOWN_CATALOG_CANONICALS.has(canonical) ||
      KNOWN_CATALOG_CANONICALS.has(rawKey)
    )
  );
  return {
    raw: trimmed,
    foodPart,
    rawKey,
    name: canonical,
    quantity,
    ambiguousWarning: ambiguous?.warning || "",
    disambiguationOptions: ambiguous?.options || [],
    conceptKey: ambiguous?.conceptKey || "",
    unrecognized: Boolean(ambiguous || !isKnown),
  };
}

function displayWarnings(warnings) {
  if (currentLocale === 'en') return warnings.join(' · ');
  return warnings.map(text => text.replace(/'([^']+)'/g, (_match, name) => `“${displayIngredient(name)}”`)
    .replaceAll("mapping/vocabulary", "từ điển nguyên liệu").replaceAll("Recipe Dataset", "bộ công thức")
    .replaceAll("recipe", "công thức").replaceAll("vocabulary", "từ điển nguyên liệu")
    .replaceAll("map tới", "ánh xạ tới").replaceAll("Input", "Đầu vào")).join(" · ");
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showStatus(kind, message) {
  ui.results.hidden = !recipeFirst();
  ui.status.hidden = false;
  ui.status.className = `status-region ${kind}`;
  const icon = node("div", kind === "loading" ? "spinner" : "empty-illustration",
    kind === "loading" ? "" : "◌");
  icon.setAttribute("aria-hidden", "true");
  ui.status.replaceChildren(icon, node("p", "", message));
}

const modalUi = Object.fromEntries([
  "aiModal", "closeAiModal", "doneAiModalBtn",
  "uploadPanel", "closeUploadPanel",
  "openUploadBtn", "openCameraBtn", "unifiedInputDropTarget",
  "ingredientWorkspace", "favoritesPage", "historyPage",
  "navHomeBtn", "navFavoritesBtn", "navHistoryBtn", "brandHomeLink",
  "favoritesNavCount", "historyNavCount", "favoritesPageCount", "historyPageCount",
  "favoritesBackHomeBtn", "historyBackHomeBtn",
  "clearPantryButton", "clearPantryPrompt", "confirmClearPantry", "cancelClearPantry",
  "pantryEmptyText", "methodInfoToggle", "methodInfoPanel", "aiAlertsSection", "recipePantrySummary",
  "quantityScopeHint", "resultStatusBanner",
  "quickQuantityPopover", "quickSelectedName", "quickPresetRow",
  "quickQtyMinus", "quickQuantityInput", "quickQtyPlus", "quickPreviewText",
  "confirmQuickAdd", "cancelQuickAdd",
  "ingredientAutocomplete", "toggleCatalogBtn", "toggleCatalogLabel", "toggleCatalogHint",
  "catalogBrowserPanel", "catalogCountBadge", "closeCatalogBtn", "doneCatalogBtn",
  "catalogSearchInput", "catalogSearchClearBtn", "catalogCategoryTabs", "catalogCategorySelect",
  "catalogSummaryText", "catalogResultsScroll", "catalogItemGrid", "catalogLoadMoreBtn",
  "catalogPantryStatus", "disambiguationBox",
].map(id => [id, document.getElementById(id)]));
if (modalUi.ingredientAutocomplete) modalUi.ingredientAutocomplete.hidden = true;
if (modalUi.catalogBrowserPanel) modalUi.catalogBrowserPanel.hidden = true;
if (modalUi.disambiguationBox) modalUi.disambiguationBox.hidden = true;
let autoAnalyzeOnPick = false;
let lastModalTrigger = null;
let lastCatalogTrigger = null;
let currentPageView = "home";
let analyzeSessionId = 0;

function showResultBanner(kind, message = "") {
  const banner = modalUi.resultStatusBanner;
  if (!banner) return;
  if (!kind || !message) {
    banner.hidden = true;
    banner.textContent = "";
    banner.removeAttribute?.("data-kind");
    return;
  }
  banner.setAttribute("data-kind", kind);
  banner.textContent = message;
  banner.hidden = false;
}

function getFocusableIn(container) {
  if (!container || typeof container.querySelectorAll !== "function") return [];
  const selector = 'button:not([disabled]):not([hidden]), [href]:not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([disabled])';
  return [...container.querySelectorAll(selector)].filter(el => {
    if (el.hidden) return false;
    if (typeof el.closest === "function" && el.closest("[hidden]")) return false;
    return true;
  });
}

function trapModalTab(event, dialog) {
  if (event.key !== "Tab" || !dialog) return;
  const focusables = getFocusableIn(dialog);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || active === dialog) {
      event.preventDefault();
      last.focus?.();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus?.();
  }
}

function toggleInlineImagePanel(forceOpen) {
  const panel = modalUi.uploadPanel || document.getElementById("uploadPanel");
  if (!panel) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  if (shouldOpen) {
    panel.hidden = false;
    modalUi.openUploadBtn?.classList.add("active");
    modalUi.openUploadBtn?.setAttribute("aria-expanded", "true");
    panel.focus();
  } else {
    closeInlineImagePanel();
  }
}

function closeInlineImagePanel() {
  const panel = modalUi.uploadPanel || document.getElementById("uploadPanel");
  if (!panel) return;

  // Safe in-flight request handling: abort active analyze request and bump session id
  analyzeSessionId++;
  if (activeActionRequest && activeActionRequest.kind === "analyze") {
    cancelActiveActionRequest();
  }

  panel.hidden = true;
  modalUi.openUploadBtn?.classList.remove("active");
  modalUi.openUploadBtn?.setAttribute("aria-expanded", "false");

  // Keep pantry, confirmed ingredients, and selection state intact
  if (modalUi.openUploadBtn && typeof modalUi.openUploadBtn.focus === "function") {
    modalUi.openUploadBtn.focus();
  }
}

let hasRecommendedForPantry = false;
let lastRecommendResponseMeta = null;

function switchPageView(view = "home") {
  currentPageView = ["home", "favorites", "history"].includes(view) ? view : "home";
  if (currentPageView !== "home") closeInlineImagePanel();
  if (modalUi.ingredientWorkspace) modalUi.ingredientWorkspace.hidden = currentPageView !== "home";
  if (modalUi.favoritesPage) modalUi.favoritesPage.hidden = currentPageView !== "favorites";
  if (modalUi.historyPage) modalUi.historyPage.hidden = currentPageView !== "history";

  const navMap = [
    [modalUi.navHomeBtn, "home"],
    [modalUi.navFavoritesBtn, "favorites"],
    [modalUi.navHistoryBtn, "history"],
  ];
  for (const [btn, key] of navMap) {
    if (!btn) continue;
    const isActive = currentPageView === key;
    if (isActive) {
      btn.classList?.add("active");
      btn.setAttribute("aria-current", "page");
    } else {
      btn.classList?.remove("active");
      btn.removeAttribute("aria-current");
    }
  }
  updateNavBadges();
}

function setAiMode(mode) {
  const isCam = mode === "camera";
  tabUploadMode?.classList.toggle("active", !isCam);
  tabUploadMode?.setAttribute("aria-selected", String(!isCam));
  tabCameraMode?.classList.toggle("active", isCam);
  tabCameraMode?.setAttribute("aria-selected", String(isCam));
  const camRow = document.getElementById("cameraActionsRow");
  if (camRow) camRow.hidden = !isCam;
  if (!isCam && cameraController && cameraController.state !== "idle") {
    cameraController.stop();
  }
}

function openAiModal(mode = "camera", trigger = null) {
  if (mode === "upload") {
    toggleInlineImagePanel(true);
    return;
  }
  if (!modalUi.aiModal) return;
  lastModalTrigger = trigger || document.activeElement || null;
  modalUi.aiModal.hidden = false;
  setAiMode("camera");
  document.getElementById("cameraDialog")?.focus();
}

function closeAiModal() {
  if (!modalUi.aiModal) return;
  if (cameraController && cameraController.state !== "idle") {
    cameraController.stop();
  }
  modalUi.aiModal.hidden = true;
  if (lastModalTrigger && typeof lastModalTrigger.focus === "function") lastModalTrigger.focus();
}

function resetSelection() {
  if (isLoading) return;
  cameraHasCapture = false;
  cameraController?.stop();
  selectedFile = null;
  diagnosticExporter?.select(null);
  stillOverlay?.clear();
  resetGuardReview();
  ui.input.value = "";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  ui.preview.removeAttribute("src");
  ui.previewWrap.hidden = true;
  ui.placeholder.hidden = false;
  ui.fileRow.hidden = true;
  ui.button.disabled = true;
  if (recipeFirst()) ui.status.hidden = true;
  else showStatus("", "Chọn một ảnh để khám phá món ngon từ những gì bạn có.");
}

function validateFile(file) {
  if (!file) return "Vui lòng chọn ảnh.";
  if (!appConfig) return "Chưa tải được cấu hình ứng dụng. Vui lòng thử lại.";
  const extension = file.name.split(".").pop().toLowerCase();
  const expectedMime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  if (!appConfig.allowed_extensions.includes(extension) || file.type !== expectedMime[extension]) {
    return "File không hợp lệ. Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP.";
  }
  if (file.size > appConfig.max_upload_mb * 1024 * 1024) {
    return `Ảnh vượt giới hạn ${appConfig.max_upload_mb} MB.`;
  }
  return null;
}

function selectFile(file, {fromCamera = false} = {}) {
  if (isLoading) return;
  cameraHasCapture = fromCamera;
  cameraController?.stop();
  stillOverlay?.clear();
  resetGuardReview();
  const error = validateFile(file);
  if (error) {
    resetSelection();
    showStatus("error", error);
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  selectedFile = file;
  diagnosticExporter?.select(file,fromCamera?'camera_capture':'upload');
  previewUrl = URL.createObjectURL(file);
  ui.preview.src = previewUrl;
  ui.previewWrap.hidden = false;
  ui.placeholder.hidden = true;
  ui.fileName.textContent = file.name;
  ui.fileRow.hidden = false;
  ui.button.disabled = false;
  showStatus("", "Ảnh đã sẵn sàng. Nhấn “Phân tích ảnh” để xem kết quả.");
  if(!fromCamera) {
    cameraNotice('Ảnh tải lên đã sẵn sàng. Khung sẽ xuất hiện sau khi phân tích ảnh.');
    document.getElementById('liveMetrics').textContent='';
  }
  updateCameraControls();
}

const cameraUi = Object.fromEntries(["openCamera", "captureCamera", "retakeCamera", "stopCamera",
  "cameraVideo", "cameraLive", "cameraNotice"].map(id => [id, document.getElementById(id)]));
let cameraHasCapture = false;
let cameraController = null;

function cameraNotice(text) {
  if (!cameraUi.cameraNotice) return;
  cameraUi.cameraNotice.textContent = text;
  cameraUi.cameraNotice.hidden = !text;
}
function updateCameraControls() {
  const busy = cameraController && ["opening", "live", "capturing"].includes(cameraController.state);
  const hasStream = Boolean(cameraController?.stream);
  cameraUi.openCamera.hidden = Boolean(busy || cameraHasCapture);
  cameraUi.openCamera.disabled = isLoading || !appConfig || !cameraController;
  cameraUi.captureCamera.hidden = !hasStream;
  cameraUi.captureCamera.disabled = isLoading || !cameraController?.ready;
  cameraUi.retakeCamera.hidden = !cameraHasCapture || Boolean(busy);
  cameraUi.retakeCamera.disabled = isLoading || !appConfig;
  cameraUi.stopCamera.hidden = !busy;
  cameraUi.cameraLive.hidden = !hasStream;
  ui.previewWrap.hidden = hasStream || !selectedFile;
  ui.placeholder.hidden = hasStream || Boolean(selectedFile);
  ui.button.disabled = isLoading || !selectedFile || Boolean(busy);
  diagnosticExporter?.refresh();
}

if (typeof SmartKitchenCamera !== "undefined") {
  cameraController = new SmartKitchenCamera({video: cameraUi.cameraVideo,
    onState: state => {
      updateCameraControls();
      if (state === 'live') {
        lastLiveMetrics=null;document.getElementById('liveMetrics').textContent='';liveDetection?.start();
      }
      else liveDetection?.stop();
      if (state === "opening") cameraNotice("Đang mở camera. Nếu được hỏi, hãy cho phép trình duyệt truy cập camera.");
      if (state === "live") cameraNotice("Camera đang gửi frame lấy mẫu để nhận diện; không lưu ảnh hoặc tự gợi ý món.");
      if (state === "capturing") cameraNotice("Đang chụp ảnh...");
    }, onError: cameraNotice});
} else {
  cameraNotice("Không tải được chức năng camera. Bạn vẫn có thể chọn ảnh từ thiết bị.");
}
cameraUi.openCamera.addEventListener("click", () => { if (!isLoading) cameraController?.start(); });
cameraUi.retakeCamera.addEventListener("click", () => { if (!isLoading) cameraController?.start(); });
cameraUi.stopCamera.addEventListener("click", () => {
  cameraController?.stop(); cameraNotice("Đã tắt camera. Ảnh đã chọn vẫn có thể dùng để phân tích.");
});
cameraUi.captureCamera.addEventListener("click", async () => {
  if (isLoading || !cameraController) return;
  const blob = await cameraController.capture();
  if (!blob) return;
  const extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[blob.type];
  if (!extension) { cameraNotice("Camera trả định dạng ảnh không được hỗ trợ. Hãy chọn ảnh từ thiết bị."); return; }
  ui.input.value = "";
  const file = new File([blob], `camera-${Date.now()}.${extension}`, {type: blob.type});
  closeAiModal();
  toggleInlineImagePanel(true);
  selectFile(file, {fromCamera: true});
  if (selectedFile === file) {
    cameraNotice("Đã chụp khung hình. Đang phân tích nguyên liệu...");
    if (typeof ui.form.requestSubmit === "function") ui.form.requestSubmit();
    else ui.form.dispatchEvent(new Event("submit", {cancelable: true}));
  }
});
for (const name of ["loadedmetadata", "loadeddata"]) cameraUi.cameraVideo.addEventListener(name, updateCameraControls);
if (typeof document.addEventListener === "function") document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraController && cameraController.state !== "idle") {
    cameraController?.stop(); cameraNotice("Đã tắt camera khi ứng dụng không còn hiển thị.");
  }
});
if (typeof window.addEventListener === "function") window.addEventListener("pagehide", () => cameraController?.stop());
updateCameraControls();

// AI Mode Tabs (1. Upload Image vs 2. Use Camera) inside Area C
const tabUploadMode = document.getElementById("tabUploadMode");
const tabCameraMode = document.getElementById("tabCameraMode");
tabUploadMode?.addEventListener("click", () => {
  tabUploadMode.classList.add("active");
  tabUploadMode.setAttribute("aria-selected", "true");
  tabCameraMode?.classList.remove("active");
  tabCameraMode?.setAttribute("aria-selected", "false");
  if (cameraController && cameraController.state !== "idle") {
    cameraController.stop();
  }
  cameraNotice("Chế độ tải ảnh: Kéo thả hoặc bấm Chọn ảnh để phân tích nguyên liệu.");
});
tabCameraMode?.addEventListener("click", () => {
  tabCameraMode.classList.add("active");
  tabCameraMode.setAttribute("aria-selected", "true");
  tabUploadMode?.classList.remove("active");
  tabUploadMode?.setAttribute("aria-selected", "false");
  cameraNotice("Chế độ camera: Bấm “Mở camera” bên dưới để bắt đầu quét nguyên liệu.");
  cameraUi.openCamera?.focus();
});

if (typeof SmartKitchenDetection !== 'undefined') {
  stillOverlay = new SmartKitchenDetection.BoxOverlay(document.getElementById('stillBoxes'),displayIngredient);
  liveOverlay = new SmartKitchenDetection.BoxOverlay(document.getElementById('liveBoxes'),displayIngredient);
  liveDetection = new SmartKitchenDetection.LiveDetection({video:cameraUi.cameraVideo,overlay:liveOverlay,
    fetchFrame(blob,signal) {const body=new FormData();body.append('image',blob,'live-frame.jpg');return fetch('/api/detect-frame',{method:'POST',body,signal});},
    onError:cameraNotice,onMetrics(metrics) {lastLiveMetrics=metrics;document.getElementById('liveMetrics').textContent=`Nhận diện mẫu: ${metrics.fps.toFixed(2)} FPS · ${metrics.latency_ms.toFixed(0)} ms`;
      if (metrics.scope?.profile === 'fridge30_precision_guard') {
        cameraNotice(guardEmptyMessage());
      } else if (['fridge11','fridge30_experimental'].includes(metrics.scope?.profile) && !metrics.boxes?.length) {
        cameraNotice(metrics.excluded_detections?.some(x=>x.reason==='OUT_OF_SCOPE')
          ? 'Các dự đoán hiện tại nằm ngoài danh sách hỗ trợ. Bạn có thể chụp ảnh và thêm nguyên liệu thủ công.'
          : 'Chưa phát hiện nguyên liệu thuộc danh sách hỗ trợ. Bạn có thể chụp ảnh và thêm thủ công.');
      }}});
  ui.preview.addEventListener('load',()=>stillOverlay.draw());
}
if(typeof SmartKitchenDiagnosticExport!=='undefined'){
  diagnosticExporter=new SmartKitchenDiagnosticExport({
    consent:document.getElementById('allowDiagnosticSave'),imageButton:document.getElementById('saveDiagnosticImage'),
    jsonButton:document.getElementById('saveDiagnosticJSON'),notice:document.getElementById('diagnosticSaveNotice'),
    getFile:()=>selectedFile,isBlocked:()=>isLoading||Boolean(cameraController&&cameraController.state!=='idle')});
}

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function detailRow(label, ingredients, className) {
  const line = node("div", className);
  line.append(node("span", "detail-label", label),
              node("span", "", ingredients.length ? ingredients.map(displayIngredient).join(", ") : "Không có"));
  return line;
}

const pantryUi = Object.fromEntries([
  "showAddIngredient", "addIngredientForm", "ingredientInput", "pantryNotice", "recommendButton",
  "rankingMethodSelect", "favoriteList", "historyList", "clearHistory", "storageNotice",
  "clearHistoryPrompt", "confirmClearHistory", "cancelClearHistory",
].map(id => [id, document.getElementById(id)]));
const recipeDetailUi = Object.fromEntries([
  "recipeModal", "recipeDialog", "closeRecipeModal", "recipeDetailStatus", "recipeDetailContent",
  "recipeDetailTitle", "recipeOriginalTitle", "recipeTranslationNote", "recipeIngredientList",
  "recipeInstructionsTitle", "recipeLanguageBadge", "recipeInstructionStatus",
  "recipeInstructionFallbackNote", "recipeStepText", "previousRecipeStep", "recipeStepIndicator",
  "nextRecipeStep", "recipeOriginalInstructions", "recipeOriginalStepList", "recipeSourceText",
  "recipeSourceLink", "recipeShowVietnamese", "recipeShowEnglish", "modalShowVietnamese",
  "modalShowEnglish", "recipeIngredientStatus", "recipeIngredientFallbackNote",
  "recipeIngredientsTitle", "recipeOriginalIngredients", "recipeOriginalIngredientList",
].map(id => [id, document.getElementById(id)]));
const FAVORITES_KEY = "smart_kitchen_favorites";
const HISTORY_KEY = "smart_kitchen_history";
let pantry = [];
let originalDetections = [];
let analyzedFilename = "";
let currentRecipes = [];
let detailRequestId = 0;
let currentDetailSteps = [];
let currentDetailStep = 0;
let currentRecipeDetail = null;
let currentDetailLanguage = "en";
let lastDetailTrigger = null;
const confirmedStaples = new Set();

function getConfirmedStaples() {
  return Array.from(confirmedStaples).sort();
}

function updateConfirmedStaplesUi() {
  const box = document.getElementById("confirmedStaplesList");
  const countEl = document.getElementById("confirmedStaplesCount");
  const boxes = box?.querySelectorAll?.(".staple-checkbox") || [];
  for (const cb of boxes) {
    const val = cb.value;
    cb.checked = confirmedStaples.has(val);
    cb.disabled = isLoading;
    const labelEl = cb.parentElement?.querySelector?.(".staple-check-label");
    if (labelEl) {
      const target = currentLocale === "en" ? cb.getAttribute("data-en") : cb.getAttribute("data-vi");
      if (target) labelEl.textContent = target;
    }
  }
  if (countEl) {
    const n = confirmedStaples.size;
    countEl.textContent = n === 0
      ? (currentLocale === "en" ? "None selected" : "Chưa chọn")
      : (currentLocale === "en" ? `${n} selected` : `Đã chọn ${n}`);
  }
}

(function bindConfirmedStaples() {
  const listEl = document.getElementById("confirmedStaplesList");
  const boxes = listEl?.querySelectorAll?.(".staple-checkbox") || [];
  for (const cb of boxes) {
    cb.checked = false;
    cb.addEventListener("change", () => {
      if (cb.checked) confirmedStaples.add(cb.value);
      else confirmedStaples.delete(cb.value);
      updateConfirmedStaplesUi();
      if (pantry.length) {
        hasRecommendedForPantry = false;
        pantryUi.pantryNotice.textContent = currentLocale === "en"
          ? "Confirmed staples changed. Click “Suggest recipes” to update."
          : "Gia vị nền xác nhận đã thay đổi. Bấm “Gợi ý món ăn” để cập nhật.";
      }
    });
  }
})();

const stringList = value => Array.isArray(value) && value.length <= 100 && value.every(x => typeof x === "string" && x.length <= 300);
const detailStringList = value => Array.isArray(value) && value.length <= 1000 &&
  value.every(x => typeof x === "string" && x.length <= 50000);
function validRecipe(value) {
  return value && ["string", "number"].includes(typeof value.recipe_id) &&
    typeof value.recipe_name === "string" && value.recipe_name.length <= 1000 &&
    Number.isFinite(value.match_ratio) && stringList(value.matched_ingredients) && stringList(value.missing_ingredients);
}
function foodAvailability(recipe) {
  const food = recipe.food_availability;
  return food && stringList(food.matched_ingredients) && stringList(food.missing_ingredients) ? food : recipe;
}
function validHistoryItem(item) {
  return Boolean(
    item && typeof item.name === "string" && item.name.length <= 300 &&
    (item.quantity === undefined || (typeof item.quantity === "string" && item.quantity.length <= 100)) &&
    (item.raw === undefined || (typeof item.raw === "string" && item.raw.length <= 300)) &&
    (item.count === undefined || (Number.isFinite(item.count) && item.count > 0))
  );
}
function validHistory(value) {
  return value && typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) &&
    typeof value.filename === "string" && stringList(value.detected_ingredients) &&
    stringList(value.ingredients) && stringList(value.recommendations) && ["analyze", "recommend"].includes(value.action) &&
    (value.pantry_items === undefined || (Array.isArray(value.pantry_items) && value.pantry_items.length <= 100 && value.pantry_items.every(validHistoryItem)));
}
function readStorage(key, validate, limit) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter(validate).slice(0, limit) : [];
  } catch (_error) { return []; }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (_error) { pantryUi.storageNotice.textContent = "Không thể lưu vào trình duyệt. Thay đổi chỉ được giữ trong phiên này."; }
}
const recipeKey = recipe => String(recipe.recipe_id);
let favorites = [...new Map(readStorage(FAVORITES_KEY, validRecipe, 100).map(r => [recipeKey(r), r])).values()];
let history = readStorage(HISTORY_KEY, validHistory, 20);
function recipeSnapshot(recipe) {
  const snapshot = { recipe_id: recipe.recipe_id, recipe_name: recipe.recipe_name, match_ratio: recipe.match_ratio,
    matched_ingredients: [...recipe.matched_ingredients], missing_ingredients: [...recipe.missing_ingredients] };
  const food = foodAvailability(recipe);
  if (food !== recipe) snapshot.food_availability = {
    matched_ingredients: [...food.matched_ingredients], missing_ingredients: [...food.missing_ingredients]
  };
  if (stringList(recipe.required_equipment)) snapshot.required_equipment = [...recipe.required_equipment];
  return snapshot;
}

function validRecipeDetail(value) {
  const vi = value?.translations?.vi;
  return value?.success === true && Number.isInteger(value.recipe_id) &&
    typeof value.recipe_name === "string" && stringList(value.ingredients) &&
    typeof value.instructions === "string" && detailStringList(value.instruction_steps) &&
    value.language === "en" && vi &&
    (vi.recipe_name === null || typeof vi.recipe_name === "string") &&
    (vi.instructions === null || typeof vi.instructions === "string") &&
    detailStringList(vi.instruction_steps) && typeof value.source?.dataset_name === "string" &&
    typeof value.source?.dataset_url === "string";
}

function showRecipeDetailStatus(message, error = false) {
  recipeDetailUi.recipeDetailContent.hidden = true;
  recipeDetailUi.recipeDetailStatus.hidden = false;
  recipeDetailUi.recipeDetailStatus.className = `recipe-detail-status${error ? " error" : ""}`;
  recipeDetailUi.recipeDetailStatus.textContent = message;
}

function showRecipeStep(index) {
  if (!currentDetailSteps.length) return;
  currentDetailStep = Math.max(0, Math.min(index, currentDetailSteps.length - 1));
  recipeDetailUi.recipeStepText.textContent = currentDetailSteps[currentDetailStep];
  recipeDetailUi.recipeStepIndicator.textContent = currentDetailLanguage === "en"
    ? `Step ${currentDetailStep + 1}/${currentDetailSteps.length}`
    : `Bước ${currentDetailStep + 1}/${currentDetailSteps.length}`;
  recipeDetailUi.previousRecipeStep.disabled = currentDetailStep === 0;
  recipeDetailUi.nextRecipeStep.disabled = currentDetailStep === currentDetailSteps.length - 1;
  if (typeof recipeDetailUi.recipeStepText.scrollIntoView === "function") {
    recipeDetailUi.recipeStepText.scrollIntoView({block: "nearest", behavior: "smooth"});
  }
}

function updateRecipePantrySummary(detail, language) {
  if (!modalUi.recipePantrySummary) return;
  const match = currentRecipes.find(r => Number(r.recipe_id) === Number(detail.recipe_id));
  if (!match) {
    modalUi.recipePantrySummary.replaceChildren();
    modalUi.recipePantrySummary.hidden = true;
    return;
  }
  const food = foodAvailability(match);
  const haveList = Array.isArray(food.matched_ingredients) ? food.matched_ingredients : [];
  const missList = Array.isArray(food.missing_ingredients) ? food.missing_ingredients : [];
  const isEn = language === "en";
  modalUi.recipePantrySummary.replaceChildren(
    detailRow(isEn ? "Available" : "Đang có", haveList, "detail-have"),
    detailRow(isEn ? "Need more" : "Cần bổ sung", missList, "detail-missing")
  );
  if (stringList(match.required_equipment) && match.required_equipment.length) {
    modalUi.recipePantrySummary.append(detailRow(
      isEn ? "Check equipment" : "Kiểm tra dụng cụ", match.required_equipment, "detail-equipment"));
  }
  modalUi.recipePantrySummary.hidden = false;
}

function applyRecipeLanguage(language) {
  const detail = currentRecipeDetail;
  if (!detail) return;
  currentDetailLanguage = language === "en" ? "en" : "vi";
  const vi = detail.translations.vi;
  const useVietnamese = currentDetailLanguage === "vi";
  const eligibleTitle = Boolean(vi.recipe_name && (vi.recipe_name_review_status === "reviewed" || vi.recipe_name_display_eligible === true));
  const hasVietnameseInstructions = Boolean(useVietnamese && vi.instructions &&
    vi.instruction_steps.length === detail.instruction_steps.length && vi.instruction_steps.length &&
    ["reviewed", "auto_unreviewed"].includes(vi.instructions_review_status));
  const hasVietnameseIngredients = Boolean(useVietnamese && detailStringList(vi.ingredients) &&
    vi.ingredients.length === detail.ingredients.length && ["reviewed", "auto_unreviewed"].includes(vi.ingredients_review_status));
  recipeDetailUi.recipeDetailTitle.textContent = useVietnamese && eligibleTitle ? vi.recipe_name :
    (useVietnamese ? displayRecipe(detail.recipe_name, detail.recipe_id) : detail.recipe_name);
  const hasTranslatedTitle = useVietnamese && recipeDetailUi.recipeDetailTitle.textContent !== detail.recipe_name;
  recipeDetailUi.recipeOriginalTitle.textContent = hasTranslatedTitle ? `Tên gốc: ${detail.recipe_name}` : "";
  recipeDetailUi.recipeOriginalTitle.hidden = !hasTranslatedTitle;
  if (useVietnamese && eligibleTitle && vi.recipe_name_review_status === "auto_unreviewed") {
    recipeDetailUi.recipeTranslationNote.textContent = "Tên món: Dịch tự động (chưa rà soát)";
    recipeDetailUi.recipeTranslationNote.hidden = false;
  } else {
    recipeDetailUi.recipeTranslationNote.textContent = "";
    recipeDetailUi.recipeTranslationNote.hidden = true;
  }

  recipeDetailUi.recipeIngredientList.replaceChildren();
  const displayedIngredients = hasVietnameseIngredients ? vi.ingredients : detail.ingredients;
  displayedIngredients.forEach(ingredient => recipeDetailUi.recipeIngredientList.append(node("li", "", ingredient)));
  recipeDetailUi.recipeIngredientsTitle.textContent = useVietnamese
    ? (hasVietnameseIngredients ? "Nguyên liệu tiếng Việt" : "Nguyên liệu gốc (English)")
    : "Ingredients";
  if (hasVietnameseIngredients && vi.ingredients_review_status === "auto_unreviewed") {
    recipeDetailUi.recipeIngredientStatus.textContent = "Dịch tự động";
    recipeDetailUi.recipeIngredientStatus.hidden = false;
  } else {
    recipeDetailUi.recipeIngredientStatus.textContent = "";
    recipeDetailUi.recipeIngredientStatus.hidden = true;
  }
  if (recipeDetailUi.recipeIngredientFallbackNote) {
    if (useVietnamese && !hasVietnameseIngredients) {
      recipeDetailUi.recipeIngredientFallbackNote.textContent = "Chưa có bản dịch tiếng Việt cho nguyên liệu; đang hiển thị bản gốc tiếng Anh.";
      recipeDetailUi.recipeIngredientFallbackNote.hidden = false;
    } else {
      recipeDetailUi.recipeIngredientFallbackNote.textContent = "";
      recipeDetailUi.recipeIngredientFallbackNote.hidden = true;
    }
  }
  recipeDetailUi.recipeOriginalIngredients.hidden = !hasVietnameseIngredients;
  recipeDetailUi.recipeOriginalIngredientList.replaceChildren();
  detail.ingredients.forEach(s => recipeDetailUi.recipeOriginalIngredientList.append(node("li", "", s)));

  currentDetailSteps = hasVietnameseInstructions ? vi.instruction_steps : detail.instruction_steps;
  recipeDetailUi.recipeInstructionsTitle.textContent = useVietnamese
    ? (hasVietnameseInstructions ? "Hướng dẫn tiếng Việt" : "Hướng dẫn gốc (English)")
    : "Instructions";
  recipeDetailUi.recipeLanguageBadge.textContent = hasVietnameseInstructions ? "VI" : "EN";
  if (hasVietnameseInstructions && vi.instructions_review_status === "auto_unreviewed") {
    recipeDetailUi.recipeInstructionStatus.textContent = "Dịch tự động";
    recipeDetailUi.recipeInstructionStatus.hidden = false;
  } else {
    recipeDetailUi.recipeInstructionStatus.textContent = "";
    recipeDetailUi.recipeInstructionStatus.hidden = true;
  }
  if (recipeDetailUi.recipeInstructionFallbackNote) {
    if (useVietnamese && !hasVietnameseInstructions) {
      recipeDetailUi.recipeInstructionFallbackNote.textContent = "Chưa có bản dịch tiếng Việt cho các bước nấu; đang hiển thị hướng dẫn gốc tiếng Anh.";
      recipeDetailUi.recipeInstructionFallbackNote.hidden = false;
    } else {
      recipeDetailUi.recipeInstructionFallbackNote.textContent = "";
      recipeDetailUi.recipeInstructionFallbackNote.hidden = true;
    }
  }

  recipeDetailUi.recipeOriginalStepList.replaceChildren();
  detail.instruction_steps.forEach(step => recipeDetailUi.recipeOriginalStepList.append(node("li", "", step)));
  recipeDetailUi.recipeOriginalInstructions.hidden = !hasVietnameseInstructions;
  recipeDetailUi.recipeSourceText.textContent = `${detail.source.dataset_name} · ${detail.source.original_content_source} · ${detail.source.license}`;
  recipeDetailUi.recipeSourceLink.href = detail.source.dataset_url;
  recipeDetailUi.recipeShowVietnamese?.setAttribute?.("aria-pressed", String(useVietnamese));
  recipeDetailUi.recipeShowEnglish?.setAttribute?.("aria-pressed", String(!useVietnamese));
  recipeDetailUi.modalShowVietnamese?.setAttribute?.("aria-pressed", String(useVietnamese));
  recipeDetailUi.modalShowEnglish?.setAttribute?.("aria-pressed", String(!useVietnamese));
  updateRecipePantrySummary(detail, currentDetailLanguage);
  showRecipeStep(Math.min(currentDetailStep, currentDetailSteps.length - 1));
}

function renderRecipeDetail(detail) {
  currentRecipeDetail = detail;
  currentDetailStep = 0;
  applyRecipeLanguage(currentLocale);
  recipeDetailUi.recipeDetailStatus.hidden = true;
  recipeDetailUi.recipeDetailContent.hidden = false;
}

async function openRecipeDetail(recipe, trigger) {
  if (cameraController && cameraController.state !== "idle") {
    cameraController.stop();
    cameraNotice("Đã tắt camera khi mở công thức. Ảnh đã chọn vẫn được giữ.");
  }
  const requestId = ++detailRequestId;
  lastDetailTrigger = trigger || null;
  recipeDetailUi.recipeModal.hidden = false;
  document.body?.classList.add('detail-open');
  recipeDetailUi.recipeDialog.setAttribute("aria-busy", "true");
  showRecipeDetailStatus("Đang tải chi tiết công thức...");
  recipeDetailUi.recipeDialog.focus();
  try {
    const response = await fetch(`/api/recipes/${encodeURIComponent(recipe.recipe_id)}`);
    const data = await response.json();
    if (requestId !== detailRequestId) return;
    if (!response.ok || !validRecipeDetail(data)) {
      throw new Error(data.message || "Dữ liệu chi tiết công thức không hợp lệ.");
    }
    if (data.recipe_id !== Number(recipe.recipe_id)) {
      throw new Error("Mã công thức trả về không khớp món đã chọn. Vui lòng thử lại.");
    }
    renderRecipeDetail(data);
  } catch (error) {
    if (requestId !== detailRequestId) return;
    showRecipeDetailStatus(error instanceof TypeError
      ? "Không tải được chi tiết do lỗi kết nối. Vui lòng thử lại."
      : error.message, true);
  } finally {
    if (requestId === detailRequestId) recipeDetailUi.recipeDialog.setAttribute("aria-busy", "false");
  }
}

function closeRecipeDetail() {
  detailRequestId += 1;
  recipeDetailUi.recipeModal.hidden = true;
  document.body?.classList.remove('detail-open');
  recipeDetailUi.recipeDetailContent.hidden = true;
  currentDetailSteps = [];
  currentRecipeDetail = null;
  if (lastDetailTrigger && typeof lastDetailTrigger.focus === "function") lastDetailTrigger.focus();
}

function updateNavBadges() {
  if (modalUi.favoritesNavCount) {
    modalUi.favoritesNavCount.textContent = String(favorites.length);
    modalUi.favoritesNavCount.hidden = favorites.length === 0;
  }
  if (modalUi.historyNavCount) {
    modalUi.historyNavCount.textContent = String(history.length);
    modalUi.historyNavCount.hidden = history.length === 0;
  }
  if (modalUi.favoritesPageCount) {
    modalUi.favoritesPageCount.textContent = currentLocale === "en" ? `${favorites.length} saved` : `${favorites.length} món đã lưu`;
  }
  if (modalUi.historyPageCount) {
    modalUi.historyPageCount.textContent = currentLocale === "en" ? `${history.length} entries` : `${history.length} mục`;
  }
}

function createRecipeThumbPlaceholder() {
  const box = node("span", "recipe-thumb-placeholder");
  box.setAttribute("aria-hidden", "true");
  box.textContent = "🍲";
  return box;
}

function _buildRecipeCard(recipe, index, allowFavorite, group, isTwoTierView = false) {
  const card = node("article", "recipe-card");
  card.setAttribute("data-recipe-id", String(recipe.recipe_id));
  const top = node("div", "recipe-top");
  const titleButton = node("button", "recipe-name recipe-name-button", displayRecipe(recipe.recipe_name, recipe.recipe_id));
  titleButton.type = "button";
  titleButton.setAttribute("aria-label", `Xem công thức: ${displayRecipe(recipe.recipe_name, recipe.recipe_id)}`);
  titleButton.addEventListener("click", () => openRecipeDetail(recipe, titleButton));
  top.append(node("span", "recipe-rank", String(index + 1)), titleButton, createRecipeThumbPlaceholder());
  const food = foodAvailability(recipe);
  const needsEquipment = stringList(recipe.required_equipment) && recipe.required_equipment.length > 0;
  const matchedCount = Array.isArray(food.matched_ingredients) ? food.matched_ingredients.length : 0;
  const totalCount = matchedCount + (Array.isArray(food.missing_ingredients) ? food.missing_ingredients.length : 0);
  const displayRatio = food === recipe ? recipe.match_ratio : (totalCount ? matchedCount / totalCount : 0);
  const matchLabel = currentLocale === "en"
    ? `Ingredient types matched: ${matchedCount}/${totalCount || matchedCount}`
    : `Khớp loại nguyên liệu: ${matchedCount}/${totalCount || matchedCount}`;
  const match = node("div", "match-line");
  match.title = currentLocale === "en"
    ? "Ratio of matched ingredient types to total recipe ingredient types (not AI accuracy or quantity sufficiency)."
    : "Tỷ lệ số loại nguyên liệu khớp trên tổng số loại nguyên liệu công thức (không phải độ chính xác AI hay mức đủ định lượng).";
  match.append(node("span", "", matchLabel), node("strong", "", percent(displayRatio)));
  const bar = node("div", "match-bar");
  const fill = node("div", "match-fill");
  fill.style.width = percent(displayRatio);
  bar.append(fill);

  if (isTwoTierView && group === "B") {
    const badges = node("div", "tier-card-badges");
    const missN = Number.isFinite(recipe.missing_required_count)
      ? recipe.missing_required_count
      : (Array.isArray(food.missing_ingredients) ? food.missing_ingredients.length : 0);
    if (missN > 0) {
      badges.append(node(
        "span",
        "tier-pill tier-pill-missing",
        currentLocale === "en"
          ? `Needs ${missN} more ingredient${missN === 1 ? "" : "s"}`
          : `Cần mua thêm ${missN} nguyên liệu`
      ));
    }
    if (recipe.matched_core_count > 0) {
      badges.append(node(
        "span",
        "tier-pill tier-pill-core",
        currentLocale === "en" ? "Matches primary ingredient" : "Khớp nguyên liệu chính"
      ));
    }
    if (recipe.passes_baseline_25pct === false) {
      badges.append(node(
        "span",
        "tier-pill tier-pill-expanded",
        currentLocale === "en" ? "Match < 25% · Extended match" : "Khớp < 25% · Gợi ý mở rộng"
      ));
    }
    card.append(top, match, bar, badges);
  } else {
    card.append(top, match, bar);
  }

  const details = node("div", "recipe-details");
  details.append(detailRow(currentLocale === "en" ? "Available" : "Có sẵn", food.matched_ingredients, "detail-have"));
  const unavailable = group && !isTwoTierView && stringList(recipe.unavailable_ingredients)
    ? recipe.unavailable_ingredients
    : food.missing_ingredients;
  if (!group || isTwoTierView || unavailable.length) {
    details.append(detailRow(
      currentLocale === "en" ? (isTwoTierView && group === "B" ? "To buy" : "Missing") : (isTwoTierView && group === "B" ? "Cần mua" : "Cần thêm"),
      unavailable,
      "detail-missing"
    ));
  }
  card.append(details);

  if (!group || isTwoTierView) {
    const hasMissingOrEquip = unavailable.length > 0 || needsEquipment;
    if (recipe.readiness_status === 'CAN_COOK_NOW' || (recipe.suggestion_status === 'pantry_match' && !hasMissingOrEquip)) {
      card.append(node('p', 'mapping-note readiness-ready', currentLocale === 'en'
        ? 'Ready with listed ingredients (amounts not checked)'
        : 'Có thể nấu với nguyên liệu đã liệt kê (chưa xét định lượng)'));
    } else if (unavailable.length > 0) {
      card.append(node('p', 'mapping-note', currentLocale === 'en' ? 'Needs additional ingredients' : 'Cần bổ sung nguyên liệu'));
    } else if (!needsEquipment && (recipe.suggestion_status === 'needs_ingredients'
        || recipe.readiness_status === 'NEEDS_ADDITIONAL_INGREDIENTS')) {
      card.append(node('p', 'mapping-note', currentLocale === 'en' ? 'Check ingredient match' : 'Cần kiểm tra độ khớp nguyên liệu'));
    }
  }
  if (Array.isArray(recipe.verified_compatible_ingredients)) {
    const forms = recipe.verified_compatible_ingredients.filter(item => typeof item?.recipe === 'string' && typeof item?.pantry === 'string');
    for (const item of forms) {
      const note = String(item.evidence || '').startsWith('confirmed_staple_family:')
        ? (currentLocale === 'en' ? 'matched from confirmed staple' : 'khớp từ gia vị nền đã xác nhận')
        : (currentLocale === 'en' ? 'prepare as specified' : 'sơ chế theo công thức');
      card.append(node('p', 'privacy-note', `${displayIngredient(item.recipe)} ← ${displayIngredient(item.pantry)} (${note}).`));
    }
  }
  if (Array.isArray(recipe.conditional_ingredients) && recipe.conditional_ingredients.length) {
    const forms = recipe.conditional_ingredients.filter(item => typeof item?.recipe === 'string' && typeof item?.pantry === 'string')
      .map(item => `${displayIngredient(item.recipe)} (${displayIngredient(item.pantry)})`);
    if (forms.length) card.append(node('p', 'mapping-note', `${currentLocale === 'en' ? 'Check the required form' : 'Kiểm tra đúng loại hoặc dạng sơ chế'}: ${forms.join(', ')}.`));
  }
  if (stringList(recipe.missing_core_ingredients) && recipe.missing_core_ingredients.length) {
    card.append(node('p', 'mapping-note', `Thiếu nguyên liệu chính: ${recipe.missing_core_ingredients.map(displayIngredient).join(', ')}.`));
  }
  if (needsEquipment) {
    const title = currentLocale === 'en' ? 'Check equipment' : 'Kiểm tra dụng cụ';
    card.append(node('p', 'privacy-note', `${title}: ${recipe.required_equipment.join(', ')}.`));
  }
  if (displayRecipe(recipe.recipe_name, recipe.recipe_id) !== recipe.recipe_name) {
    card.append(node("p", "recipe-original-title", `Tên gốc: ${recipe.recipe_name}`));
  }
  if (currentLocale === 'vi') {
    const meta = displayCatalog.recipes[String(recipe.recipe_id)];
    if (meta && (!meta.title || !meta.ingredients_available || !meta.instructions_available))
      card.append(node('p', 'recipe-language-note', 'Thiếu bản Việt; đang hiển thị nguồn English.'));
  }
  const detailButton = node("button", "secondary-button recipe-detail-button", "Xem công thức");
  detailButton.type = "button";
  detailButton.addEventListener("click", () => openRecipeDetail(recipe, detailButton));
  card.append(detailButton);
  if (allowFavorite) {
    const saved = favorites.some(r => recipeKey(r) === recipeKey(recipe));
    const button = node("button", "secondary-button favorite-button", saved ? "♥ Đã lưu" : "♡ Lưu");
    button.type = "button";
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", `${saved ? "Bỏ lưu" : "Lưu món"}: ${displayRecipe(recipe.recipe_name, recipe.recipe_id)}`);
    button.addEventListener("click", () => {
      if (saved) favorites = favorites.filter(r => recipeKey(r) !== recipeKey(recipe));
      else if (favorites.length < 100) favorites.unshift(recipeSnapshot(recipe));
      else {
        pantryUi.storageNotice.hidden = false;
        pantryUi.storageNotice.textContent = "Đã lưu 100 công thức. Hãy bỏ lưu một món trước khi thêm.";
        return;
      }
      persist(FAVORITES_KEY, favorites);
      renderRecipes(currentRecipes, ui.recipeList);
      renderRecipes(favorites, pantryUi.favoriteList);
    });
    card.append(button);
  }
  return card;
}

function renderRecipes(recipes, container, allowFavorite = true) {
  const isTwoTierActive = Boolean(
    container === ui.recipeList
    && lastRecommendResponseMeta?.two_tier === true
    && Array.isArray(lastRecommendResponseMeta?.tier_a_recommendations)
    && Array.isArray(lastRecommendResponseMeta?.tier_b_recommendations)
  );
  const tierA = isTwoTierActive ? lastRecommendResponseMeta.tier_a_recommendations : [];
  const tierB = isTwoTierActive ? lastRecommendResponseMeta.tier_b_recommendations : [];
  const totalDisplayed = isTwoTierActive ? (tierA.length + tierB.length) : recipes.length;

  if (container === ui.recipeList) {
    const title = document.getElementById("recipesTitle");
    if (title) {
      title.textContent = isTwoTierActive && totalDisplayed > 0
        ? (currentLocale === "en"
          ? `${totalDisplayed} recipes (Tier A: ${tierA.length} · Tier B: ${tierB.length})`
          : `${totalDisplayed} món (Tầng A: ${tierA.length} · Tầng B: ${tierB.length})`)
        : `${recipes.length} món`;
    }
  }
  updateNavBadges();
  container.replaceChildren();
  if (!totalDisplayed) {
    if (container === ui.recipeList) {
      const emptyCard = node("div", "empty-results-card");
      const emptyIcon = node("div", "empty-results-icon", "🥗");
      emptyIcon.setAttribute("aria-hidden", "true");
      const stepsGrid = node("div", "empty-steps-grid");
      const stepsData = currentLocale === "en"
        ? [
            ["Step 1", "Enter ingredients & quantities on the left"],
            ["Step 2", "Choose how you want recipes ranked"],
            ["Step 3", "Click “Suggest recipes” & view steps"],
          ]
        : [
            ["Bước 1", "Nhập nguyên liệu kèm định lượng ở cột trái"],
            ["Bước 2", "Chọn phương pháp gợi ý món ăn phù hợp"],
            ["Bước 3", "Bấm “Gợi ý món ăn” và xem chi tiết cách nấu"],
          ];
      for (const [num, text] of stepsData) {
        const stepBox = node("div", "empty-step-item");
        stepBox.append(node("span", "empty-step-num", num), node("span", "empty-step-text", text));
        stepsGrid.append(stepBox);
      }
      const recommendedEmpty = Boolean(pantry.length && hasRecommendedForPantry);
      const emptyDetail = lastRecommendResponseMeta?.empty_detail || null;
      const emptyDesc = recommendedEmpty
        ? (
          (currentLocale === "en" ? emptyDetail?.explanation_en : emptyDetail?.explanation_vi)
          || (lastRecommendResponseMeta?.warnings?.length ? displayWarnings(lastRecommendResponseMeta.warnings) : "")
          || "Chưa có công thức phù hợp trong bộ dữ liệu. Hãy thử thêm nguyên liệu phổ biến như trứng, cà chua, thịt gà, hành tây."
        )
        : pantry.length
        ? "Danh sách nguyên liệu đã sẵn sàng. Bấm “Gợi ý món ăn” để xem công thức phù hợp."
        : "Thêm nguyên liệu ở cột bên trái rồi bấm “Gợi ý món ăn” để xem công thức phù hợp.";
      emptyCard.append(
        emptyIcon,
        node("p", "empty-results-title", recommendedEmpty ? "Chưa có công thức phù hợp" : "Sẵn sàng gợi ý món ăn"),
        node("p", "empty-results-desc", emptyDesc)
      );
      const suggestedAdditions = recommendedEmpty && Array.isArray(emptyDetail?.suggested_additions)
        ? emptyDetail.suggested_additions.filter(s => s && s.canonical)
        : [];
      if (suggestedAdditions.length) {
        const suggBox = node("div", "empty-suggestions-box");
        suggBox.append(node(
          "p",
          "empty-suggestions-label",
          currentLocale === "en" ? "Quick-add common pairings:" : "Thêm nhanh nguyên liệu đi kèm:"
        ));
        const suggRow = node("div", "empty-suggestions-row");
        for (const item of suggestedAdditions) {
          const label = currentLocale === "en"
            ? (item.display_en || item.canonical)
            : (item.display_vi || displayIngredient(item.canonical));
          const btn = node("button", "quick-chip", `+ ${label}`);
          btn.type = "button";
          btn.disabled = isLoading || pantry.some(p => p.name === item.canonical);
          btn.addEventListener("click", () => {
            if (isLoading || pantry.some(p => p.name === item.canonical)) return;
            pantry.push({ name: item.canonical, source: "manual", count: 1 });
            pantryChanged();
            pantryUi.recommendButton?.focus?.();
          });
          suggRow.append(btn);
        }
        suggBox.append(suggRow);
        emptyCard.append(suggBox);
      } else if (!recommendedEmpty) {
        emptyCard.append(stepsGrid);
      }
      container.append(emptyCard);
    } else if (container === pantryUi.favoriteList) {
      const emptyFav = node("div", "empty-results-card");
      const emptyIcon = node("div", "empty-results-icon", "♥");
      emptyIcon.setAttribute("aria-hidden", "true");
      const goHomeBtn = node("button", "secondary-button", "← Về Trang chủ gợi ý món");
      goHomeBtn.type = "button";
      goHomeBtn.addEventListener("click", () => switchPageView("home"));
      emptyFav.append(
        emptyIcon,
        node("p", "empty-results-title", "Chưa có món yêu thích nào"),
        node("p", "empty-results-desc", "Khi tìm thấy công thức ưng ý ở Trang chủ, hãy nhấn nút “♡ Lưu” trên thẻ món ăn để lưu vào trang này."),
        goHomeBtn
      );
      container.append(emptyFav);
    } else {
      container.append(node("p", "privacy-note", "Chưa có công thức để hiển thị."));
    }
  } else if (isTwoTierActive) {
    const tierAHeader = node("div", "tier-section-header tier-a-header");
    tierAHeader.append(
      node("span", "", currentLocale === "en"
        ? "Tier A · Ready to cook now (CAN_COOK_NOW)"
        : "Tầng A · Có thể nấu ngay (CAN_COOK_NOW)"),
      node("span", "tier-section-count", `${tierA.length}`)
    );
    container.append(tierAHeader);
    if (tierA.length) {
      tierA.forEach((recipe, idx) => {
        container.append(_buildRecipeCard(recipe, idx, allowFavorite, "A", true));
      });
    } else {
      container.append(node(
        "p",
        "tier-a-empty-note",
        currentLocale === "en"
          ? "0 Tier A dishes right now (Water, Salt, Pepper, Oil are NOT assumed unless checked on the left). Check Tier B below for missing-item shopping lists."
          : "Hiện chưa có món Tầng A đủ điều kiện nấu ngay (Nước, Muối, Tiêu, Dầu ăn KHÔNG tự giả định trừ khi bạn xác nhận ở cột trái). Xem các món gợi ý ở Tầng B bên dưới."
      ));
    }

    const tierBHeader = node("div", "tier-section-header tier-b-header");
    tierBHeader.append(
      node("span", "", currentLocale === "en"
        ? "Tier B · Needs additional ingredients"
        : "Tầng B · Cần bổ sung nguyên liệu"),
      node("span", "tier-section-count", `${tierB.length}`)
    );
    container.append(tierBHeader);
    const basisNotice = currentLocale === "en"
      ? lastRecommendResponseMeta?.tier_summary?.basis_notice_en
      : lastRecommendResponseMeta?.tier_summary?.basis_notice_vi;
    if (lastRecommendResponseMeta?.tier_summary?.basis_status === "PARTIAL_UNRESOLVED_INPUT" && basisNotice) {
      container.append(node("p", "tier-a-empty-note", basisNotice));
    }
    if (tierB.length) {
      tierB.forEach((recipe, idx) => {
        container.append(_buildRecipeCard(recipe, idx, allowFavorite, "B", true));
      });
    }
  } else {
    const groups = currentLocale === 'en'
      ? {A:'Group A · Ready with listed ingredient types', B:'Group B · Needs a few extra ingredients', C:'Group C · Reference or check requirements'}
      : {A:'Nhóm A · Đủ loại nguyên liệu chính theo danh sách', B:'Nhóm B · Cần bổ sung ít nguyên liệu', C:'Nhóm C · Tham khảo hoặc cần thêm nguyên liệu'};
    let previousGroup;
    recipes.forEach((recipe, index) => {
      const group = Object.hasOwn(groups, recipe.readiness_group) ? recipe.readiness_group : null;
      if (container === ui.recipeList && group && group !== previousGroup) {
        container.append(node('h4', 'recipe-group-title', groups[group]));
        previousGroup = group;
      }
      container.append(_buildRecipeCard(recipe, index, allowFavorite, group, false));
    });
  }
}

recipeDetailUi.closeRecipeModal.addEventListener("click", closeRecipeDetail);
recipeDetailUi.recipeModal.addEventListener("click", event => {
  if (event.target === recipeDetailUi.recipeModal) closeRecipeDetail();
});
recipeDetailUi.previousRecipeStep.addEventListener("click", () => showRecipeStep(currentDetailStep - 1));
recipeDetailUi.nextRecipeStep.addEventListener("click", () => showRecipeStep(currentDetailStep + 1));
function changeGlobalLanguage(locale) {
  if(globalI18n) globalI18n.set(locale); else {currentLocale=locale;if(currentRecipeDetail)applyRecipeLanguage(locale);}
}
recipeDetailUi.recipeShowVietnamese.addEventListener("click", () => changeGlobalLanguage("vi"));
recipeDetailUi.recipeShowEnglish.addEventListener("click", () => changeGlobalLanguage("en"));
recipeDetailUi.modalShowVietnamese?.addEventListener?.("click", () => changeGlobalLanguage("vi"));
recipeDetailUi.modalShowEnglish?.addEventListener?.("click", () => changeGlobalLanguage("en"));
function syncMethodRadioCards(method) {
  const value = method || "final";
  for (const card of (document.querySelectorAll?.(".method-card") || [])) {
    const radio = card.querySelector?.('input[type="radio"]');
    const matched = radio?.value === value;
    card.classList?.toggle("active", Boolean(matched));
    if (radio) radio.checked = Boolean(matched);
  }
}

function updateRankerSummary(method, locale) {
  syncMethodRadioCards(method);
  const summary = document.getElementById('activeRankerSummary');
  if (!summary) return;
  summary.textContent = method === 'ml_tfidf'
    ? (locale === 'en' ? 'By similar ingredients' : 'Theo nguyên liệu tương đồng')
    : method === 'ml_lsa'
    ? (locale === 'en' ? 'Explore related recipes' : 'Khám phá món liên quan')
    : (locale === 'en' ? 'Default (recommended)' : 'Mặc định (khuyên dùng)');
}
function refreshGlobalLanguage(locale=currentLocale) {
  currentLocale=locale;
  const visionNotice = document.getElementById('visionDevelopmentNotice');
  if (visionNotice) {
    visionNotice.hidden = !canDetectImages();
    visionNotice.textContent = locale === 'en'
      ? 'Image / Webcam — Experimental, under development. Results may be incorrect or incomplete; review and confirm the ingredients.'
      : 'Ảnh / Webcam — Thử nghiệm, đang phát triển. Có thể nhận nhầm hoặc bỏ sót; hãy kiểm tra và xác nhận nguyên liệu.';
  }
  const cameraNotice = document.getElementById('cameraDevelopmentNotice');
  if (cameraNotice) cameraNotice.textContent = locale === 'en'
    ? 'Webcam — Experimental, under development. Results may be incorrect or incomplete; review and confirm the ingredients.'
    : 'Webcam — Thử nghiệm, đang phát triển. Có thể nhận nhầm hoặc bỏ sót; hãy kiểm tra và xác nhận nguyên liệu.';
  const method = appConfig?.ranking_method || pantryUi.rankingMethodSelect?.value || 'final';
  updateRankerSummary(method, locale);
  if (recipeFirst() || appConfig) {
    const basisEl = document.getElementById('rankingBasis');
    if (basisEl) {
      basisEl.textContent = method === 'quality_hybrid' || method === 'quality_overlap'
        ? (locale === 'en' ? 'Ranked by ingredient match' : 'Gợi ý theo độ khớp nguyên liệu')
        : method === 'ml_tfidf'
        ? (locale === 'en' ? 'Finds recipes with similar ingredients' : 'Tìm món có nguyên liệu gần giống')
        : method === 'ml_lsa'
        ? (locale === 'en' ? 'Suggests additional related recipes' : 'Gợi ý thêm những món có liên quan')
        : method === 'tfidf_cosine'
        ? (locale === 'en' ? 'By similar ingredients' : 'Theo nguyên liệu tương đồng')
        : (locale === 'en' ? 'Prioritizes recipes matching your current ingredients' : 'Ưu tiên món phù hợp với nguyên liệu bạn đang có');
    }
  }
  recipeDetailUi.recipeShowVietnamese.setAttribute('aria-pressed',String(locale==='vi'));
  recipeDetailUi.recipeShowEnglish.setAttribute('aria-pressed',String(locale==='en'));
  recipeDetailUi.modalShowVietnamese?.setAttribute?.('aria-pressed',String(locale==='vi'));
  recipeDetailUi.modalShowEnglish?.setAttribute?.('aria-pressed',String(locale==='en'));
  if (typeof buildCatalogItemsFromSource === "function") buildCatalogItemsFromSource();
  if (modalUi.catalogBrowserPanel && !modalUi.catalogBrowserPanel.hidden) { renderCatalogCategoryTabs(); renderCatalogBrowserGrid(); }
  updateConfirmedStaplesUi();
  renderPantry();renderRecipes(currentRecipes,ui.recipeList);renderRecipes(favorites,pantryUi.favoriteList);renderHistory();
  if (lastDetectionAudit || (modalUi.aiModal && !modalUi.aiModal.hidden)) renderScopeNotice();
  if (precisionGuard() && lastDetectionAudit) renderGuardReview();
  if(currentRecipeDetail)applyRecipeLanguage(locale);
  stillOverlay?.draw();liveOverlay?.draw();
}
globalI18n?.onChange(refreshGlobalLanguage);
if (typeof document.addEventListener === "function") {
  document.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      if (!recipeDetailUi.recipeModal.hidden) { trapModalTab(event, recipeDetailUi.recipeDialog); return; }
      if (modalUi.aiModal && !modalUi.aiModal.hidden) { trapModalTab(event, document.getElementById("cameraDialog")); return; }
      return;
    }
    if (event.key !== "Escape") return;
    if (!recipeDetailUi.recipeModal.hidden) { closeRecipeDetail(); return; }
    if (modalUi.aiModal && !modalUi.aiModal.hidden) { closeAiModal(); return; }
    if (modalUi.quickQuantityPopover && !modalUi.quickQuantityPopover.hidden) {
      closeQuickQuantitySelector(); return;
    }
    if (modalUi.uploadPanel && !modalUi.uploadPanel.hidden) {
      closeInlineImagePanel(); return;
    }
    if (modalUi.methodInfoPanel && !modalUi.methodInfoPanel.hidden) {
      modalUi.methodInfoPanel.hidden = true;
      modalUi.methodInfoToggle?.setAttribute("aria-expanded", "false");
      modalUi.methodInfoToggle?.focus?.();
      return;
    }
    if (modalUi.clearPantryPrompt && !modalUi.clearPantryPrompt.hidden) {
      modalUi.clearPantryPrompt.hidden = true; return;
    }
    if (pantryUi.clearHistoryPrompt && !pantryUi.clearHistoryPrompt.hidden) {
      pantryUi.clearHistoryPrompt.hidden = true;
      return;
    }
    if (modalUi.ingredientAutocomplete && !modalUi.ingredientAutocomplete.hidden) {
      closeAutocompleteDropdown();
      return;
    }
    if (modalUi.catalogBrowserPanel && !modalUi.catalogBrowserPanel.hidden) {
      toggleCatalogBrowser(false);
      return;
    }
  });
}
function buildRestoredPantryItems(record) {
  if (Array.isArray(record.pantry_items) && record.pantry_items.length) {
    return record.pantry_items.filter(validHistoryItem).map(item => ({
      name: item.name,
      source: "manual",
      count: Number.isFinite(item.count) && item.count > 0 ? item.count : 1,
      quantity: typeof item.quantity === "string" ? item.quantity : "",
      raw: typeof item.raw === "string" && item.raw ? item.raw : (item.quantity ? `${item.quantity} ${displayIngredient(item.name)}` : displayIngredient(item.name)),
      unrecognized: false,
    }));
  }
  return record.ingredients.map(name => ({
    name,
    source: "manual",
    count: 1,
    quantity: "",
    raw: displayIngredient(name),
    unrecognized: false,
  }));
}
function applyHistoryRestore(record, mode = "replace") {
  const incoming = buildRestoredPantryItems(record);
  if (!incoming.length) return;
  if (mode === "merge") {
    for (const item of incoming) {
      if (!pantry.some(existing => existing.name === item.name)) {
        pantry.push(item);
      }
    }
  } else {
    pantry = incoming;
  }
  pantryChanged();
  switchPageView("home");
}
function formatHistoryIngredients(record) {
  if (Array.isArray(record.pantry_items) && record.pantry_items.some(item => item && item.quantity)) {
    return record.pantry_items.map(item => item.quantity ? `${displayIngredient(item.name)} (${item.quantity})` : displayIngredient(item.name)).join(", ");
  }
  return record.ingredients.map(displayIngredient).join(", ");
}
function renderHistory() {
  pantryUi.historyList.replaceChildren();
  pantryUi.clearHistory.disabled = !history.length;
  updateNavBadges();
  if (!history.length) pantryUi.historyList.append(node("p", "privacy-note", "Chưa có lịch sử."));
  history.forEach(record => {
    const card = node("details", "recipe-card history-card");
    card.setAttribute("open", "");
    const restoreBtn = node("button", "secondary-button history-restore-btn", "Nạp lại nguyên liệu này");
    restoreBtn.type = "button";
    const restorePrompt = node("div", "history-restore-prompt");
    restorePrompt.hidden = true;
    const promptText = node("span", "", "");
    const replaceBtn = node("button", "secondary-button danger-solid", "Thay thế tủ bếp");
    replaceBtn.type = "button";
    const mergeBtn = node("button", "secondary-button", "Gộp vào tủ hiện tại");
    mergeBtn.type = "button";
    const cancelRestoreBtn = node("button", "secondary-button", "Hủy");
    cancelRestoreBtn.type = "button";
    const actionsWrap = node("div", "history-restore-actions");
    actionsWrap.append(replaceBtn, mergeBtn, cancelRestoreBtn);
    restorePrompt.append(promptText, actionsWrap);

    replaceBtn.addEventListener("click", () => {
      restorePrompt.hidden = true;
      applyHistoryRestore(record, "replace");
    });
    mergeBtn.addEventListener("click", () => {
      restorePrompt.hidden = true;
      applyHistoryRestore(record, "merge");
    });
    cancelRestoreBtn.addEventListener("click", () => {
      restorePrompt.hidden = true;
    });
    restoreBtn.addEventListener("click", () => {
      if (isLoading || !Array.isArray(record.ingredients) || !record.ingredients.length) return;
      if (!pantry.length) {
        applyHistoryRestore(record, "replace");
        return;
      }
      promptText.textContent = `Tủ bếp đang có ${pantry.length} nguyên liệu. Nạp từ lịch sử sẽ thay thế hay gộp vào?`;
      restorePrompt.hidden = false;
    });
    card.append(
      node("summary", "", `${new Date(record.timestamp).toLocaleString(currentLocale==='vi'?'vi-VN':'en-GB')} · ${record.action === "analyze" ? "Phân tích" : "Gợi ý lại"}`),
      node("p", "", `Tệp: ${record.filename}`),
      node("p", "", `Phát hiện: ${record.detected_ingredients.map(displayIngredient).join(", ")}`),
      node("p", "", `Nguyên liệu sử dụng: ${formatHistoryIngredients(record)}`),
      node("p", "", `Công thức: ${record.recommendations.map(name=>displayRecipe(name)).join("; ") || "Không có món phù hợp"}`),
      restoreBtn,
      restorePrompt
    );
    pantryUi.historyList.append(card);
  });
}
function saveHistory(action) {
  const pantry_items = pantry.map(x => ({
    name: x.name,
    quantity: typeof x.quantity === "string" ? x.quantity : "",
    raw: typeof x.raw === "string" ? x.raw : displayIngredient(x.name),
    count: Number.isFinite(x.count) && x.count > 0 ? x.count : 1,
  }));
  const entry = { timestamp: new Date().toISOString(), action, filename: analyzedFilename,
    detected_ingredients: originalDetections.map(x => x.name), ingredients: pantry.map(x => x.name),
    pantry_items, recommendations: currentRecipes.map(x => x.recipe_name) };
  if (needsConfirmation()) {
    if(lastDetectionAudit)entry.detection_audit=JSON.parse(JSON.stringify(lastDetectionAudit));
    entry.pantry_provenance=action==='recommend'?'USER_ACCEPTED_PANTRY_NOT_HUMAN_GT':precisionGuard()?'MODEL_ABSTAINED':'UNCONFIRMED_MODEL_PREDICTION';
  }
  history.unshift(entry);
  history = history.slice(0, 20);
  persist(HISTORY_KEY, history);
  renderHistory();
}
function editPantryChip(index, ingredient, baseLabel) {
  if (isLoading) return;
  const editText = ingredient.raw || (ingredient.quantity ? `${ingredient.quantity} ${baseLabel}` : baseLabel);
  pantry.splice(index, 1);
  pantryUi.ingredientInput.value = editText;
  pantryChanged();
  pantryUi.ingredientInput.focus();
}
function renderPantry() {
  ui.ingredientList.replaceChildren();
  ui.ingredientCount.textContent = String(pantry.length);
  if (modalUi.clearPantryButton) modalUi.clearPantryButton.hidden = pantry.length === 0;
  if (modalUi.clearPantryPrompt && pantry.length === 0) modalUi.clearPantryPrompt.hidden = true;
  if (modalUi.pantryEmptyText) modalUi.pantryEmptyText.hidden = pantry.length > 0;
  const chipEditHint = document.getElementById("chipEditHint");
  if (chipEditHint) chipEditHint.hidden = pantry.length === 0;
  if (modalUi.quantityScopeHint) {
    modalUi.quantityScopeHint.hidden = !pantry.some(item => Boolean(item.quantity));
  }
  pantry.forEach((ingredient, index) => {
    const chip = node("span", ingredient.unrecognized ? "ingredient-chip chip-unrecognized" : "ingredient-chip");
    const baseLabel = displayIngredient(ingredient.name);
    const fullLabel = ingredient.quantity ? `${baseLabel} (${ingredient.quantity})` : baseLabel;
    const labelSpan = node("span", "chip-label", fullLabel);
    labelSpan.title = `Nhấn để sửa: ${fullLabel}`;
    labelSpan.setAttribute("tabindex", "0");
    labelSpan.setAttribute("role", "button");
    labelSpan.addEventListener("click", () => editPantryChip(index, ingredient, baseLabel));
    labelSpan.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        editPantryChip(index, ingredient, baseLabel);
      }
    });
    chip.append(labelSpan,
      node("small", "", ingredient.source === "manual" ? "thủ công · x1" : ingredient.source === 'reviewed'
        ? (currentLocale === 'en' ? 'checked by you' : 'bạn đã kiểm tra') : `${percent(ingredient.confidence)} · x${ingredient.count}`));
    const remove = node("button", "chip-remove", "×");
    remove.type = "button";
    remove.title = `Xóa ${baseLabel}`;
    remove.setAttribute("aria-label", remove.title);
    remove.disabled = isLoading;
    remove.addEventListener("click", () => { pantry.splice(index, 1); pantryChanged(); });
    chip.append(remove);
    ui.ingredientList.append(chip);
  });
  pantryUi.recommendButton.disabled = isLoading || !pantry.length;
  if (typeof syncCatalogPantryState === "function") syncCatalogPantryState();
  if (typeof renderDisambiguationBox === "function") renderDisambiguationBox();
}
function pantryChanged() {
  hasRecommendedForPantry = false;
  lastRecommendResponseMeta = null;
  showResultBanner(null);
  renderPantry();
  pantryUi.pantryNotice.textContent = pantry.length ? "Danh sách nguyên liệu đã thay đổi. Bấm “Gợi ý món ăn” để cập nhật." : "";
  if (needsConfirmation() || recipeFirst()) {
    currentRecipes=[];renderRecipes(currentRecipes,ui.recipeList);
  }
  if (needsConfirmation() && !recipeFirst()) {
    pantryUi.recommendButton.textContent=currentLocale==='en'?'Confirm ingredients & suggest':'Xác nhận nguyên liệu & gợi ý';
    pantryUi.pantryNotice.textContent='Danh sách chưa xác nhận sau thay đổi. Kiểm tra rồi bấm xác nhận để gợi ý lại.';
  } else if (recipeFirst()) {
    pantryUi.recommendButton.textContent=currentLocale==='en'?'Suggest recipes':'Gợi ý món ăn';
  }
}
function setBusy(busy) {
  isLoading = busy;
  ui.button.disabled = busy || !selectedFile;
  ui.input.disabled = busy;
  ui.remove.disabled = busy;
  pantryUi.showAddIngredient.disabled = busy;
  pantryUi.ingredientInput.disabled = busy;
  pantryUi.addIngredientForm.querySelector("button").disabled = busy;
  if (modalUi.openUploadBtn) modalUi.openUploadBtn.disabled = busy;
  if (modalUi.openCameraBtn) modalUi.openCameraBtn.disabled = busy;
  for (const card of (document.querySelectorAll?.(".method-card") || [])) {
    if (busy) card.classList?.add("is-disabled");
    else card.classList?.remove("is-disabled");
    const radio = card.querySelector?.('input[type="radio"]');
    if (radio) radio.disabled = busy;
  }
  for (const quickBtn of (document.querySelectorAll?.(".quick-chip") || [])) {
    quickBtn.disabled = busy;
  }
  updateConfirmedStaplesUi();
  renderPantry();
  updateCameraControls();
}
function actionAbortError(request) {
  const error = new Error(request.abortReason === 'timeout' ? 'Request deadline exceeded' : 'Request cancelled');
  error.name = request.abortReason === 'timeout' ? 'TimeoutError' : 'AbortError';
  return error;
}
function beginActionRequest(kind) {
  const request = {id: ++actionRequestSequence, kind, controller: new AbortController(),
    deadlineAt: Date.now() + ACTION_DEADLINES_MS[kind],
    hadResults: !ui.results.hidden || pantry.length > 0 || currentRecipes.length > 0};
  request.cancelled = new Promise((_resolve, reject) => {
    request.onAbort = () => reject(actionAbortError(request));
    request.controller.signal.addEventListener('abort', request.onAbort, {once: true});
  });
  request.timer = setTimeout(() => {
    request.abortReason = 'timeout';
    request.controller.abort();
  }, ACTION_DEADLINES_MS[kind]);
  activeActionRequest = request;
  setBusy(true);
  return request;
}
async function actionResponseJson(request, url, options) {
  // Race the entire fetch + JSON operation, including transports which ignore abort.
  const operation = (async () => {
    const response = await fetch(url, {...options, signal: request.controller.signal});
    if (request.controller.signal.aborted) throw actionAbortError(request);
    const data = await response.json();
    return {response, data};
  })();
  const value = await Promise.race([operation, request.cancelled]);
  if (Date.now() >= request.deadlineAt && !request.controller.signal.aborted) {
    request.abortReason = 'timeout';
    request.controller.abort();
  }
  if (request.controller.signal.aborted) throw actionAbortError(request);
  return value;
}
function ownsActionRequest(request) { return activeActionRequest === request; }
function finishActionRequest(request) {
  clearTimeout(request.timer);
  request.controller.signal.removeEventListener('abort', request.onAbort);
  if (!ownsActionRequest(request)) return;
  activeActionRequest = null;
  setBusy(false);
  ui.buttonLabel.textContent = 'Phân tích ảnh';
  pantryUi.recommendButton.textContent = (needsConfirmation() && !recipeFirst())
    ? (currentLocale==='en'?'Confirm ingredients & suggest':'Xác nhận nguyên liệu & gợi ý')
    : (currentLocale==='en'?'Suggest recipes':'Gợi ý món ăn');
}
function cancelActiveActionRequest() {
  // Cancels waiting in this tab; it does not promise to stop server inference.
  if (activeActionRequest) activeActionRequest.controller.abort();
}
if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', cancelActiveActionRequest);
function actionFailureMessage(request, error) {
  if (request.abortReason === 'timeout') return request.kind === 'analyze'
    ? 'Đã quá thời gian chờ phân tích ảnh (120 giây). Ảnh, pantry và kết quả trước được giữ. Máy chủ có thể vẫn đang xử lý; ứng dụng không tự gửi lại.'
    : 'Đã quá thời gian chờ gợi ý (30 giây). Pantry và kết quả trước được giữ. Máy chủ có thể vẫn đang xử lý; ứng dụng không tự gửi lại.';
  if (error?.name === 'AbortError') return 'Đã hủy chờ phản hồi. Ảnh, pantry và kết quả trước được giữ. Máy chủ có thể vẫn đang xử lý.';
  if (error?.name === 'TypeError') return 'Có lỗi kết nối. Ảnh, pantry và kết quả trước được giữ. Vui lòng thử lại khi sẵn sàng.';
  return error?.message || 'Có lỗi xảy ra, vui lòng thử lại.';
}
function showActionFailure(request, error) {
  const message = actionFailureMessage(request, error);
  if (request.kind === 'recommend') {
    const recommendMsg = `Chưa cập nhật gợi ý. ${message}`;
    pantryUi.pantryNotice.textContent = recommendMsg;
    showResultBanner('error', recommendMsg);
    ui.results.hidden = !request.hadResults && !currentRecipes.length;
  } else {
    showStatus('error', message);
    ui.results.hidden = !request.hadResults;
  }
}
function renderScopeNotice() {
  if (appConfig?.scope?.profile!=='fridge11' && !needsConfirmation()) return;
  const full30=needsConfirmation();
  const hasDetectionActivity = Boolean(lastDetectionAudit || (modalUi.aiModal && !modalUi.aiModal.hidden));
  if (!hasDetectionActivity) {
    if (modalUi.aiAlertsSection) modalUi.aiAlertsSection.hidden = true;
    return;
  }
  if (modalUi.aiAlertsSection) modalUi.aiAlertsSection.hidden = false;
  const notice = document.getElementById('scopeNotice');
  notice.hidden = false;
  notice.textContent = (currentLocale === 'en'
    ? (precisionGuard()?'Full30 Precision Guard. Review suggestions or enter ingredients yourself. ':full30?'Experimental Full30: 30 classes; review predictions and confirm your pantry. ':'Smart Kitchen currently supports 11 ingredient classes in fridge photos. ')
    : appConfig.scope.notice + ' ') + appConfig.scope.supported_classes.map(c=>displayIngredient(c.name)).join(', ') + '.';
  const confidence = document.getElementById('confidenceNotice');
  confidence.hidden = false;
  confidence.textContent = currentLocale === 'en'
    ? 'YOLO confidence is an uncalibrated prediction score, not the probability of being correct.'
    : 'Confidence YOLO là điểm dự đoán chưa hiệu chuẩn, không phải xác suất chắc chắn đúng.';
  if(full30 && !recipeFirst())pantryUi.recommendButton.textContent=currentLocale==='en'?'Confirm ingredients & suggest':'Xác nhận nguyên liệu & gợi ý';
}
function resetGuardReview() {
  if (!precisionGuard() || !guardReview) return;
  guardReview.open = false;
  guardReview.hidden = true;
  if (modalUi.aiAlertsSection) modalUi.aiAlertsSection.hidden = true;
  lastDetectionAudit = null;
  if (!recipeFirst()) {
    pantry = [];
    currentRecipes = [];
  }
}
function reviewCandidates() {
  return (lastDetectionAudit?.review_candidates || []).filter(box => box.decision === 'REVIEW');
}
function drawGuardReview() {
  if (!precisionGuard() || !lastDetectionAudit || !guardReview) return;
  stillOverlay?.set({image:lastDetectionAudit.image, boxes:guardReview.open ? reviewCandidates() : [],
    reviewPrefix:currentLocale === 'en' ? 'Possibly' : 'Có thể là'});
}
guardReview?.addEventListener('toggle', drawGuardReview);
function renderGuardReview() {
  if (!guardReview) return;
  const candidates = reviewCandidates();
  guardReview.hidden = !candidates.length;
  if (candidates.length) guardReview.open = true;
  document.getElementById('guardReviewTitle').textContent = currentLocale === 'en' ? 'Detected candidates — review & confirm' : 'Ứng viên nhận diện — Kiểm tra & xác nhận';
  const list = document.getElementById('guardReviewCandidates');
  list.replaceChildren();
  // Pantry is a list of ingredient types. Preserve per-object boxes in review.
  const types = new Map(candidates.map(box => [box.canonical_ingredient, box]));
  for (const [name, box] of types) {
    if (typeof name !== 'string' || !name) continue;
    const label = displayIngredient(box.name);
    const confText = Number.isFinite(box.confidence) ? ` (${percent(box.confidence)})` : '';
    const row = node('p', '', `${currentLocale === 'en' ? 'Possibly' : 'Có thể là'} ${label}${confText} `);
    const alreadyInPantry = pantry.some(x => canonicalInput(x.name) === name);
    const button = node('button', 'secondary-button', alreadyInPantry
      ? (currentLocale === 'en' ? `✓ Added ${label}` : `✓ Đã thêm ${label}`)
      : (currentLocale === 'en' ? `I have ${label}` : `Tôi có ${label}`));
    button.type = 'button';
    button.disabled = alreadyInPantry;
    button.addEventListener('click', () => {
      if (isLoading || !guardReview.open || pantry.length >= 100 || pantry.some(x => canonicalInput(x.name) === name)) return;
      pantry.push({name, source:'reviewed', count:1});
      pantryChanged();
      button.disabled = true;
      button.textContent = currentLocale === 'en' ? `✓ Added ${label}` : `✓ Đã thêm ${label}`;
    });
    const editLink = node('span', 'candidate-action-link', currentLocale === 'en' ? 'Edit' : 'Sửa tên');
    editLink.setAttribute('role', 'button');
    editLink.setAttribute('tabindex', '0');
    const onEdit = () => {
      if (isLoading) return;
      closeAiModal();
      pantryUi.ingredientInput.value = label;
      pantryUi.ingredientInput.focus();
    };
    editLink.addEventListener('click', onEdit);
    editLink.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } });
    const dismissLink = node('span', 'candidate-action-link', currentLocale === 'en' ? 'Dismiss' : 'Bỏ qua');
    dismissLink.setAttribute('role', 'button');
    dismissLink.setAttribute('tabindex', '0');
    const onDismiss = () => { row.hidden = true; };
    dismissLink.addEventListener('click', onDismiss);
    dismissLink.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDismiss(); } });
    row.append(button, editLink, dismissLink);
    list.append(row);
  }
  drawGuardReview();
}
function renderResult(data) {
  ui.status.hidden = true;
  ui.results.hidden = false;
  document.getElementById('resultBadge').textContent = 'ĐÃ PHÂN TÍCH';
  originalDetections = precisionGuard() ? [] : data.detected_ingredients.map(x => ({...x}));
  if (!recipeFirst()) pantry = originalDetections.map(x => ({...x, source: "detected"}));
  analyzedFilename = selectedFile.name;
  currentRecipes = data.recommendations;
  if(needsConfirmation())lastDetectionAudit=data.detection;
  renderPantry();
  renderRecipes(currentRecipes, ui.recipeList);
  const outside = (data.detection?.excluded_detections || []).filter(x=>x.reason==='OUT_OF_SCOPE');
  ui.mappingNote.hidden = !data.unmapped_ingredients.length && !outside.length;
  ui.mappingNote.textContent = data.unmapped_ingredients.length ? `Chưa ánh xạ, cần xem xét: ${data.unmapped_ingredients.map(displayIngredient).join(", ")}.` : "";
  if (outside.length) ui.mappingNote.textContent += ` Đã loại ${outside.length} dự đoán ngoài phạm vi hỗ trợ khỏi danh sách và gợi ý tự động.`;
  pantryUi.pantryNotice.textContent = currentRecipes.length
    ? "Có thể thêm hoặc xóa nguyên liệu rồi gợi ý lại món."
    : "";
  if (data.status === 'NO_SUPPORTED_DETECTIONS') {
    pantryUi.pantryNotice.textContent = data.warnings?.[0] || 'Chưa có nguyên liệu thuộc phạm vi hỗ trợ. Bạn có thể thêm thủ công.';
    pantryUi.addIngredientForm.hidden = false;
    pantryUi.showAddIngredient.setAttribute('aria-expanded', 'true');
  }
  if (precisionGuard()) {
    document.getElementById('detectedTitle').textContent = currentLocale === 'en' ? 'Your ingredients' : 'Nguyên liệu của bạn';
    pantryUi.addIngredientForm.hidden = false;
    pantryUi.showAddIngredient.setAttribute('aria-expanded','true');
    ui.mappingNote.hidden = true;
    renderGuardReview();
    renderScopeNotice();
    if (!reviewCandidates().length) {
      showStatus("", guardEmptyMessage());
      pantryUi.pantryNotice.textContent = guardEmptyMessage();
    } else {
      pantryUi.pantryNotice.textContent = currentLocale === 'en'
        ? 'Review detected candidates and confirm before recommending.'
        : 'Kiểm tra và xác nhận ứng viên AI trước khi thêm vào nguyên liệu của bạn.';
    }
  } else if (appConfig?.scope?.profile==='fridge30_experimental') {
    pantryUi.pantryNotice.textContent=data.status==='NO_DETECTIONS'
      ? 'Chưa có dự đoán đủ ngưỡng. Bạn có thể thêm nguyên liệu thủ công rồi xác nhận.'
      : 'Đây là dự đoán chưa xác nhận. Kiểm tra/xóa mục sai, thêm mục thiếu rồi bấm Xác nhận nguyên liệu & gợi ý.';
    if(!pantry.length){pantryUi.addIngredientForm.hidden=false;pantryUi.showAddIngredient.setAttribute('aria-expanded','true');}
    ui.mappingNote.hidden=false;ui.mappingNote.textContent=displayWarnings(data.warnings||[]);
    renderScopeNotice();
  }
  ui.timing.textContent = `Xử lý ${Math.round(data.timing_ms.request)} ms`;
  saveHistory("analyze");
}
function offerManualPantry(data) {
  if (recipeFirst()) return;
  if (!['NO_INGREDIENT_DETECTED', 'NO_MAPPED_INGREDIENT', 'NO_SUPPORTED_INGREDIENT', 'OUT_OF_SCOPE_DETECTIONS'].includes(data.error)) return;
  const button = node('button', 'secondary-button', 'Nhập nguyên liệu thủ công');
  button.type = 'button';
  button.addEventListener('click', () => {
    // Explicit recovery starts a new manual pantry; never count it as YOLO output.
    originalDetections = [];
    pantry = [];
    currentRecipes = [];
    analyzedFilename = selectedFile?.name || '';
    ui.status.hidden = true;
    ui.results.hidden = false;
    document.getElementById('resultBadge').textContent = 'NHẬP THỦ CÔNG';
    ui.timing.textContent = '';
    ui.mappingNote.hidden = false;
    ui.mappingNote.textContent = `${data.message} Danh sách dưới đây do bạn nhập, không phải kết quả nhận diện.`;
    renderPantry();
    renderRecipes(currentRecipes, ui.recipeList);
    pantryUi.pantryNotice.textContent = 'Thêm nguyên liệu bạn có để tiếp tục gợi ý món.';
    pantryUi.addIngredientForm.hidden = false;
    pantryUi.showAddIngredient.setAttribute('aria-expanded', 'true');
    pantryUi.ingredientInput.focus();
  });
  ui.status.append(button);
}

function addManualIngredientsFromText(rawText) {
  if (isLoading) return;
  const fullNormalized = normalizedInput(rawText);
  if (!fullNormalized) {
    pantryUi.pantryNotice.textContent = "Vui lòng nhập tên nguyên liệu.";
    return;
  }
  const fullParsed = parseManualInputSegment(rawText);
  if (localizationData.ambiguous_inputs.includes(fullNormalized)) {
    pantryUi.pantryNotice.textContent = "Tên nguyên liệu này có nhiều cách hiểu. Vui lòng nhập tên cụ thể hơn.";
    return;
  }
  const segments = (fullParsed && !fullParsed.unrecognized && String(rawText || "").includes(","))
    ? [String(rawText || "").trim()]
    : String(rawText || "").split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  if (!segments.length) {
    pantryUi.pantryNotice.textContent = "Vui lòng nhập tên nguyên liệu.";
    return;
  }
  let addedCount = 0;
  let duplicateCount = 0;
  const warnings = [];
  for (const seg of segments) {
    const segNorm = normalizedInput(seg);
    if (localizationData.ambiguous_inputs.includes(segNorm)) {
      warnings.push(`“${seg}” có nhiều cách hiểu, vui lòng nhập tên cụ thể hơn.`);
      continue;
    }
    const parsed = parseManualInputSegment(seg);
    if (!parsed || !parsed.name) continue;
    if (pantry.length >= 100) {
      pantryUi.pantryNotice.textContent = "Tối đa 100 nguyên liệu.";
      break;
    }
    const existing = pantry.find(x => canonicalInput(x.name) === canonicalInput(parsed.name));
    if (existing) {
      if (parsed.quantity && parsed.quantity !== existing.quantity) {
        existing.quantity = parsed.quantity;
        existing.raw = parsed.raw;
        existing.source = "manual";
        addedCount += 1;
        continue;
      }
      duplicateCount += 1;
      continue;
    }
    pantry.push({
      name: parsed.name,
      source: "manual",
      count: 1,
      quantity: parsed.quantity || "",
      raw: parsed.raw,
      unrecognized: parsed.unrecognized,
    });
    addedCount += 1;
    if (parsed.ambiguousWarning) {
      warnings.push(parsed.ambiguousWarning);
    } else if (parsed.unrecognized) {
      warnings.push(currentLocale === "en"
        ? `Note: “${parsed.foodPart}” is not in the vocabulary; kept in your pantry to check.`
        : `Lưu ý: “${parsed.foodPart}” chưa có trong từ điển, vẫn giữ lại để đối chiếu.`);
    }
  }
  if (addedCount === 0 && duplicateCount > 0 && !warnings.length) {
    pantryUi.pantryNotice.textContent = "Nguyên liệu này đã có trong danh sách.";
    return;
  }
  pantryUi.ingredientInput.value = "";
  pantryChanged();
  if (warnings.length) {
    ui.mappingNote.hidden = false;
    ui.mappingNote.textContent = warnings.join(" ");
  } else if (addedCount > 0) {
    ui.mappingNote.hidden = true;
    ui.mappingNote.textContent = "";
  }
  pantryUi.ingredientInput.focus();
}

// Keep manual ingredient form always visible when clicking #showAddIngredient
pantryUi.showAddIngredient.addEventListener("click", () => {
  pantryUi.addIngredientForm.hidden = false;
  pantryUi.showAddIngredient.setAttribute("aria-expanded", "true");
  pantryUi.ingredientInput.focus();
});

pantryUi.addIngredientForm.addEventListener("submit", event => {
  event.preventDefault();
  closeAutocompleteDropdown();
  addManualIngredientsFromText(pantryUi.ingredientInput.value);
});

// --- PHASE B/C/D: CATALOG BROWSER, AUTOCOMPLETE & DISAMBIGUATION ---
const CATALOG_PAGE_SIZE = 36;
let catalogAllItems = [];
let catalogCategories = [...DEFAULT_CATALOG_CATEGORIES];
let activeCatalogCategory = "all";
let activeCatalogSearch = "";
let catalogVisibleLimit = CATALOG_PAGE_SIZE;
let autocompleteSuggestions = [];
let activeAutocompleteIndex = -1;

function buildCatalogItemsFromSource() {
  const fromApi = localizationData?.pantry_catalog?.items;
  if (Array.isArray(fromApi) && fromApi.length > 0) {
    catalogCategories = Array.isArray(localizationData.pantry_catalog.categories) && localizationData.pantry_catalog.categories.length
      ? localizationData.pantry_catalog.categories
      : [...DEFAULT_CATALOG_CATEGORIES];
    catalogAllItems = fromApi.map(item => ({
      ingredient_id: item.ingredient_id,
      canonical_name: item.canonical_name,
      display_name_vi: item.display_name_vi,
      display_name_en: item.display_name_en || item.canonical_name.replaceAll("_", " "),
      category: item.category || "vegetables",
      recipe_count: Number(item.recipe_count) || 1,
      aliases_vi: Array.isArray(item.aliases_vi) ? item.aliases_vi : [],
      aliases_vi_unaccented: Array.isArray(item.aliases_vi_unaccented) ? item.aliases_vi_unaccented : [],
      aliases_en: Array.isArray(item.aliases_en) ? item.aliases_en : [],
      yolo30_class: Boolean(item.yolo30_class),
      _searchVi: normalizedInput(item.display_name_vi),
      _searchPlain: stripVietnameseDiacritics(item.display_name_vi),
      _searchEn: normalizedInput(item.display_name_en || item.canonical_name),
      _aliasesNorm: [
        ...(item.aliases_vi || []).map(normalizedInput),
        ...(item.aliases_vi_unaccented || []).map(stripVietnameseDiacritics),
        ...(item.aliases_en || []).map(normalizedInput),
      ],
    }));
  } else {
    catalogCategories = [...DEFAULT_CATALOG_CATEGORIES];
    catalogAllItems = COMPACT_CATALOG_ITEMS.map(row => ({
      ingredient_id: row[0],
      canonical_name: row[1],
      display_name_vi: row[2],
      display_name_en: row[3],
      category: row[4],
      recipe_count: row[5],
      aliases_vi: row[6],
      aliases_vi_unaccented: row[7],
      aliases_en: row[8],
      yolo30_class: row[9],
      _searchVi: normalizedInput(row[2]),
      _searchPlain: stripVietnameseDiacritics(row[2]),
      _searchEn: normalizedInput(row[3]),
      _aliasesNorm: [
        ...row[6].map(normalizedInput),
        ...row[7].map(stripVietnameseDiacritics),
        ...row[8].map(normalizedInput),
      ],
    }));
  }
  const total = catalogAllItems.length;
  if (modalUi.toggleCatalogLabel) {
    modalUi.toggleCatalogLabel.textContent = currentLocale === "en"
      ? `Browse all ${total} ingredients`
      : `Xem tất cả ${total} nguyên liệu`;
  }
  if (modalUi.toggleCatalogHint) {
    modalUi.toggleCatalogHint.textContent = currentLocale === "en"
      ? "Filter 12 categories or search in Vietnamese / English"
      : "Duyệt 12 nhóm thực phẩm hoặc tìm nhanh theo tên Việt / Anh";
  }
  if (modalUi.catalogCountBadge) {
    modalUi.catalogCountBadge.textContent = currentLocale === "en"
      ? `${total} searchable ingredients`
      : `${total} nguyên liệu có thể tìm`;
  }
}

function getCategoryLabel(catId) {
  const found = catalogCategories.find(c => c.id === catId);
  if (!found) return catId;
  return currentLocale === "en" ? found.label_en : found.label_vi;
}

function searchCatalogItems(rawQuery, categoryFilter = "all") {
  let pool = catalogAllItems;
  if (categoryFilter && categoryFilter !== "all") {
    pool = pool.filter(item => item.category === categoryFilter);
  }
  const trimmed = String(rawQuery || "").normalize("NFC").trim();
  if (!trimmed) {
    return {
      quantityPrefix: "",
      foodQuery: "",
      ambiguousMatches: [],
      items: pool,
    };
  }
  let quantityPrefix = "";
  let foodPart = trimmed;
  const qMatch = QUANTITY_PREFIX_RE.exec(trimmed);
  if (qMatch && qMatch[2]?.trim()) {
    quantityPrefix = qMatch[1].trim();
    foodPart = qMatch[2].trim();
  }
  const qNorm = normalizedInput(foodPart);
  const qPlain = stripVietnameseDiacritics(foodPart);
  if (!qNorm) {
    return { quantityPrefix, foodQuery: "", ambiguousMatches: [], items: pool };
  }

  const ambiguousMatches = [];
  if (!categoryFilter || categoryFilter === "all") {
    for (const [key, amb] of Object.entries(AMBIGUOUS_CONCEPT_DEFS)) {
      const triggersNorm = (amb.triggers || []).map(normalizedInput);
      const triggersPlain = (amb.triggers || []).map(stripVietnameseDiacritics);
      if (triggersNorm.includes(qNorm) || triggersPlain.includes(qPlain)) {
        ambiguousMatches.push({ key, ...amb });
      }
    }
  }

  const scored = [];
  for (const item of pool) {
    let score = 0;
    if (item._searchVi === qNorm || item._searchEn === qNorm || item._searchPlain === qPlain) {
      score = 1000;
    } else if (item._aliasesNorm.includes(qNorm) || item._aliasesNorm.includes(qPlain)) {
      score = 900;
    } else if (item._searchVi.startsWith(qNorm) || item._searchPlain.startsWith(qPlain) || item._searchEn.startsWith(qNorm)) {
      const lenDiff = Math.max(0, item._searchVi.length - qNorm.length);
      score = 780 + Math.max(0, 60 - lenDiff * 4);
    } else if (item._aliasesNorm.some(a => a.startsWith(qNorm) || a.startsWith(qPlain))) {
      score = 680;
    } else if (
      item._searchVi.includes(qNorm) ||
      (qPlain.length >= 2 && item._searchPlain.includes(qPlain)) ||
      item._searchEn.includes(qNorm) ||
      item._aliasesNorm.some(a => a.includes(qNorm) || (qPlain.length >= 2 && a.includes(qPlain)))
    ) {
      score = 450;
    }
    if (score > 0) {
      scored.push({ score: score + Math.min(item.recipe_count, 500) / 1000, item });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.item.display_name_vi.localeCompare(b.item.display_name_vi, "vi"));
  return {
    quantityPrefix,
    foodQuery: foodPart,
    ambiguousMatches,
    items: scored.map(s => s.item),
  };
}

function getActiveTypingSegment(fullValue) {
  const raw = String(fullValue || "");
  const lastSepIdx = Math.max(raw.lastIndexOf(","), raw.lastIndexOf(";"), raw.lastIndexOf("\n"));
  if (lastSepIdx === -1) {
    return { prefixSegmentsText: "", activeSegment: raw.trim() };
  }
  return {
    prefixSegmentsText: raw.slice(0, lastSepIdx + 1).trim(),
    activeSegment: raw.slice(lastSepIdx + 1).trim(),
  };
}

function closeAutocompleteDropdown() {
  autocompleteSuggestions = [];
  activeAutocompleteIndex = -1;
  if (modalUi.ingredientAutocomplete) {
    modalUi.ingredientAutocomplete.hidden = true;
    modalUi.ingredientAutocomplete.replaceChildren();
  }
}

function commitAutocompleteSuggestion(suggestion) {
  if (!suggestion || isLoading) return;
  const { prefixSegmentsText } = getActiveTypingSegment(pantryUi.ingredientInput.value);
  const chosenText = suggestion.quantityPrefix
    ? `${suggestion.quantityPrefix} ${suggestion.insertLabel}`
    : suggestion.insertLabel;
  closeAutocompleteDropdown();
  if (prefixSegmentsText) {
    addManualIngredientsFromText(prefixSegmentsText);
  }
  const canon = suggestion.canonical_name;
  if (canon) {
    const qty = suggestion.quantityPrefix || "";
    const existing = pantry.find(x => canonicalInput(x.name) === canon || x.name === canon);
    if (existing) {
      if (qty && qty !== existing.quantity) {
        existing.quantity = qty;
        existing.raw = chosenText;
        existing.source = "manual";
      } else if (!prefixSegmentsText) {
        pantryUi.pantryNotice.textContent = "Nguyên liệu này đã có trong danh sách.";
        pantryUi.ingredientInput.value = "";
        pantryUi.ingredientInput.focus();
        return;
      }
    } else if (pantry.length < 100) {
      pantry.push({
        name: canon,
        source: "manual",
        count: 1,
        quantity: qty,
        raw: chosenText,
        unrecognized: false,
      });
    } else {
      pantryUi.pantryNotice.textContent = "Tối đa 100 nguyên liệu.";
    }
    pantryUi.ingredientInput.value = "";
    pantryChanged();
    ui.mappingNote.hidden = true;
    ui.mappingNote.textContent = "";
    pantryUi.ingredientInput.focus();
    return;
  }
  const combinedText = prefixSegmentsText ? `${prefixSegmentsText} ${chosenText}` : chosenText;
  addManualIngredientsFromText(combinedText);
}

function highlightAutocompleteRow(newIndex) {
  if (!modalUi.ingredientAutocomplete || !autocompleteSuggestions.length) return;
  const max = autocompleteSuggestions.length - 1;
  activeAutocompleteIndex = newIndex < 0 ? max : newIndex > max ? 0 : newIndex;
  const children = modalUi.ingredientAutocomplete.children || [];
  for (let i = 0; i < children.length; i++) {
    const row = children[i];
    const active = i === activeAutocompleteIndex;
    row.classList?.toggle("active", active);
    row.setAttribute("aria-selected", String(active));
  }
}

function updateAutocompleteDropdown() {
  if (!modalUi.ingredientAutocomplete || isLoading) return;
  const { activeSegment } = getActiveTypingSegment(pantryUi.ingredientInput.value);
  if (!activeSegment || activeSegment.length < 1) {
    closeAutocompleteDropdown();
    return;
  }
  const { quantityPrefix, ambiguousMatches, items } = searchCatalogItems(activeSegment, "all");
  const suggestions = [];

  for (const amb of ambiguousMatches) {
    for (const opt of (amb.disambiguation_options || []).slice(0, 4)) {
      const catItem = catalogAllItems.find(it => it.canonical_name === opt.canonical_name);
      suggestions.push({
        kind: "disambiguation",
        canonical_name: opt.canonical_name,
        display_name_vi: opt.display_name_vi,
        display_name_en: opt.display_name_en || opt.canonical_name,
        categoryLabel: currentLocale === "en" ? "Specific choice" : "Chọn loại cụ thể",
        recipe_count: catItem?.recipe_count || 0,
        quantityPrefix,
        insertLabel: currentLocale === "en" ? (opt.display_name_en || opt.canonical_name) : opt.display_name_vi,
      });
    }
  }

  const seenCanon = new Set(suggestions.map(s => s.canonical_name));
  for (const item of items) {
    if (seenCanon.has(item.canonical_name)) continue;
    seenCanon.add(item.canonical_name);
    suggestions.push({
      kind: "catalog",
      canonical_name: item.canonical_name,
      display_name_vi: item.display_name_vi,
      display_name_en: item.display_name_en,
      categoryLabel: getCategoryLabel(item.category),
      recipe_count: item.recipe_count,
      quantityPrefix,
      insertLabel: currentLocale === "en" ? item.display_name_en : item.display_name_vi,
    });
    if (suggestions.length >= 10) break;
  }

  if (!suggestions.length) {
    closeAutocompleteDropdown();
    return;
  }

  autocompleteSuggestions = suggestions;
  activeAutocompleteIndex = -1;
  modalUi.ingredientAutocomplete.replaceChildren();

  suggestions.forEach((sug, idx) => {
    const optionBtn = node("button", "autocomplete-option-row");
    optionBtn.type = "button";
    optionBtn.setAttribute("role", "option");
    optionBtn.setAttribute("aria-selected", "false");
    optionBtn.setAttribute("data-canonical", sug.canonical_name);

    const primaryLabel = currentLocale === "en" ? sug.display_name_en : sug.display_name_vi;
    const secondaryLabel = currentLocale === "en" ? sug.display_name_vi : sug.display_name_en;
    const fullPrimary = sug.quantityPrefix ? `${sug.quantityPrefix} ${primaryLabel}` : primaryLabel;

    const leftWrap = node("span", "autocomplete-main-text");
    const nameEl = node("strong", "autocomplete-name-vi", fullPrimary);
    const enEl = node("span", "autocomplete-name-en", `(${secondaryLabel})`);
    leftWrap.append(nameEl, enEl);

    const rightWrap = node("span", "autocomplete-meta-badges");
    const catBadge = node("span", sug.kind === "disambiguation" ? "autocomplete-cat-badge is-disambig" : "autocomplete-cat-badge", sug.categoryLabel);
    const inPantry = pantry.some(p => canonicalInput(p.name) === sug.canonical_name);
    const actionBadge = node(
      "span",
      inPantry ? "autocomplete-add-hint in-pantry" : "autocomplete-add-hint",
      inPantry
        ? (currentLocale === "en" ? "✓ In pantry" : "✓ Đã có")
        : (currentLocale === "en" ? "+ Add" : "+ Thêm")
    );
    rightWrap.append(catBadge, actionBadge);

    optionBtn.append(leftWrap, rightWrap);
    optionBtn.addEventListener("mousedown", event => {
      // Prevent input blur before click commits
      event.preventDefault();
    });
    optionBtn.addEventListener("click", () => {
      commitAutocompleteSuggestion(sug);
    });
    optionBtn.addEventListener("mouseenter", () => {
      highlightAutocompleteRow(idx);
    });
    modalUi.ingredientAutocomplete.append(optionBtn);
  });

  modalUi.ingredientAutocomplete.hidden = false;
}

function renderCatalogCategoryTabs() {
  if (!modalUi.catalogCategoryTabs && !modalUi.catalogCategorySelect) return;
  const allLabel = currentLocale === "en"
    ? `All (${catalogAllItems.length})`
    : `Tất cả (${catalogAllItems.length})`;

  if (modalUi.catalogCategoryTabs) {
    modalUi.catalogCategoryTabs.replaceChildren();

    const allTab = node(
      "button",
      activeCatalogCategory === "all" ? "catalog-cat-tab active" : "catalog-cat-tab",
      allLabel
    );
    allTab.type = "button";
    allTab.setAttribute("role", "tab");
    allTab.setAttribute("aria-selected", String(activeCatalogCategory === "all"));
    allTab.setAttribute("data-category", "all");
    allTab.addEventListener("click", () => {
      activeCatalogCategory = "all";
      catalogVisibleLimit = CATALOG_PAGE_SIZE;
      if (modalUi.catalogResultsScroll) modalUi.catalogResultsScroll.scrollTop = 0;
      renderCatalogCategoryTabs();
      renderCatalogBrowserGrid();
    });
    modalUi.catalogCategoryTabs.append(allTab);

    for (const cat of catalogCategories) {
      const count = catalogAllItems.filter(it => it.category === cat.id).length;
      if (!count) continue;
      const isSelected = activeCatalogCategory === cat.id;
      const label = currentLocale === "en" ? `${cat.label_en} (${count})` : `${cat.label_vi} (${count})`;
      const tabBtn = node("button", isSelected ? "catalog-cat-tab active" : "catalog-cat-tab", label);
      tabBtn.type = "button";
      tabBtn.setAttribute("role", "tab");
      tabBtn.setAttribute("aria-selected", String(isSelected));
      tabBtn.setAttribute("data-category", cat.id);
      tabBtn.addEventListener("click", () => {
        activeCatalogCategory = cat.id;
        catalogVisibleLimit = CATALOG_PAGE_SIZE;
        if (modalUi.catalogResultsScroll) modalUi.catalogResultsScroll.scrollTop = 0;
        renderCatalogCategoryTabs();
        renderCatalogBrowserGrid();
      });
      modalUi.catalogCategoryTabs.append(tabBtn);
    }
  }

  if (modalUi.catalogCategorySelect) {
    modalUi.catalogCategorySelect.replaceChildren();
    const allOpt = node("option", "", allLabel);
    allOpt.value = "all";
    allOpt.selected = activeCatalogCategory === "all";
    modalUi.catalogCategorySelect.append(allOpt);
    for (const cat of catalogCategories) {
      const count = catalogAllItems.filter(it => it.category === cat.id).length;
      if (!count) continue;
      const label = currentLocale === "en" ? `${cat.label_en} (${count})` : `${cat.label_vi} (${count})`;
      const opt = node("option", "", label);
      opt.value = cat.id;
      opt.selected = activeCatalogCategory === cat.id;
      modalUi.catalogCategorySelect.append(opt);
    }
    modalUi.catalogCategorySelect.value = activeCatalogCategory;
  }
}

function updateCatalogFooterStatus() {
  if (modalUi.catalogPantryStatus) {
    modalUi.catalogPantryStatus.textContent = currentLocale === "en"
      ? `${pantry.length} ingredients in your pantry`
      : `Đang có ${pantry.length} nguyên liệu trong bếp`;
  }
}

function renderCatalogBrowserGrid({ preserveScroll = false } = {}) {
  if (!modalUi.catalogItemGrid) return;
  const scrollEl = modalUi.catalogResultsScroll;
  const savedScrollTop = preserveScroll && scrollEl ? scrollEl.scrollTop : 0;
  const { items } = searchCatalogItems(activeCatalogSearch, activeCatalogCategory);
  const totalMatching = items.length;
  const visibleItems = items.slice(0, catalogVisibleLimit);

  if (modalUi.catalogSummaryText) {
    if (!totalMatching) {
      modalUi.catalogSummaryText.textContent = currentLocale === "en"
        ? "No matching ingredients found in the catalog. Try a different keyword."
        : "Không tìm thấy nguyên liệu khớp trong danh mục. Hãy thử từ khóa khác.";
    } else {
      modalUi.catalogSummaryText.textContent = currentLocale === "en"
        ? `Showing ${visibleItems.length} of ${totalMatching} supported ingredients. Click to add to your pantry.`
        : `Đang hiển thị ${visibleItems.length}/${totalMatching} nguyên liệu. Nhấn để thêm vào bếp.`;
    }
  }
  updateCatalogFooterStatus();

  modalUi.catalogItemGrid.replaceChildren();
  if (!visibleItems.length) {
    const emptyBox = node(
      "div",
      "catalog-empty-state",
      currentLocale === "en"
        ? "No ingredients match your search or category filter."
        : "Không tìm thấy nguyên liệu phù hợp với từ khóa hoặc nhóm đang chọn."
    );
    modalUi.catalogItemGrid.append(emptyBox);
  }
  const pantryCanonicals = new Set(pantry.map(x => canonicalInput(x.name)));

  for (const item of visibleItems) {
    const isAdded = pantryCanonicals.has(item.canonical_name);
    const chipBtn = node(
      "button",
      isAdded ? "catalog-item-chip in-pantry" : "catalog-item-chip"
    );
    chipBtn.type = "button";
    chipBtn.setAttribute("data-canonical", item.canonical_name);
    chipBtn.setAttribute("aria-pressed", String(isAdded));
    const mainLabel = currentLocale === "en" ? item.display_name_en : item.display_name_vi;
    const subLabel = currentLocale === "en" ? item.display_name_vi : item.display_name_en;
    chipBtn.title = `${mainLabel} (${subLabel}) · ${item.recipe_count} công thức`;

    const copyWrap = node("span", "catalog-chip-copy");
    const titleSpan = node("span", "catalog-chip-title", mainLabel);
    const subSpan = node("span", "catalog-chip-sub", subLabel);
    copyWrap.append(titleSpan, subSpan);
    const actionSpan = node(
      "span",
      "catalog-chip-status",
      isAdded
        ? (currentLocale === "en" ? "✓ Added" : "✓ Đã thêm")
        : (currentLocale === "en" ? "+ Add" : "+ Thêm")
    );
    chipBtn.append(copyWrap, actionSpan);

    chipBtn.addEventListener("click", () => {
      if (isLoading) return;
      const existingIdx = pantry.findIndex(x => canonicalInput(x.name) === item.canonical_name);
      if (existingIdx !== -1) {
        pantryUi.pantryNotice.textContent = currentLocale === "en"
          ? `"${mainLabel}" is already in your pantry.`
          : `“${mainLabel}” đã có trong danh sách nguyên liệu của bạn.`;
        return;
      }
      if (pantry.length >= 100) {
        pantryUi.pantryNotice.textContent = "Tối đa 100 nguyên liệu.";
        return;
      }
      pantry.push({
        name: item.canonical_name,
        source: "manual",
        count: 1,
        quantity: "",
        raw: item.display_name_vi,
        unrecognized: false,
      });
      pantryChanged();
    });
    modalUi.catalogItemGrid.append(chipBtn);
  }

  if (modalUi.catalogLoadMoreBtn) {
    const remaining = totalMatching - visibleItems.length;
    modalUi.catalogLoadMoreBtn.hidden = remaining <= 0;
    if (remaining > 0) {
      modalUi.catalogLoadMoreBtn.textContent = currentLocale === "en"
        ? `Show more ingredients (+${Math.min(remaining, CATALOG_PAGE_SIZE)})`
        : `Xem thêm nguyên liệu (+${Math.min(remaining, CATALOG_PAGE_SIZE)})`;
    }
  }
  if (preserveScroll && scrollEl) {
    scrollEl.scrollTop = savedScrollTop;
  }
}

function syncCatalogPantryState() {
  if (!modalUi.catalogBrowserPanel || modalUi.catalogBrowserPanel.hidden || !modalUi.catalogItemGrid) return;
  renderCatalogBrowserGrid({ preserveScroll: true });
}

function toggleCatalogBrowser(forceOpen, trigger = null) {
  const panel = modalUi.catalogBrowserPanel;
  if (!panel) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  if (shouldOpen === !panel.hidden) return;
  panel.hidden = !shouldOpen;
  modalUi.toggleCatalogBtn?.classList?.toggle("active", shouldOpen);
  modalUi.toggleCatalogBtn?.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    lastCatalogTrigger = trigger || document.activeElement || modalUi.toggleCatalogBtn || null;
    renderCatalogCategoryTabs();
    renderCatalogBrowserGrid();
    if (modalUi.catalogResultsScroll) modalUi.catalogResultsScroll.scrollTop = 0;
    if (modalUi.catalogSearchInput && typeof modalUi.catalogSearchInput.focus === "function") {
      try {
        modalUi.catalogSearchInput.focus({ preventScroll: true });
      } catch {
        modalUi.catalogSearchInput.focus();
      }
    }
  } else {
    const returnTarget = lastCatalogTrigger || modalUi.toggleCatalogBtn;
    if (returnTarget && typeof returnTarget.focus === "function") {
      try {
        returnTarget.focus({ preventScroll: true });
      } catch {
        returnTarget.focus();
      }
    }
    lastCatalogTrigger = null;
  }
}

function renderDisambiguationBox() {
  const box = modalUi.disambiguationBox;
  if (!box) return;
  const ambiguousPantryItems = [];
  for (let idx = 0; idx < pantry.length; idx++) {
    const pItem = pantry[idx];
    const norm = normalizedInput(pItem.name);
    const plain = stripVietnameseDiacritics(pItem.name);
    const amb = GENERIC_AMBIGUOUS_CONCEPTS[norm] || GENERIC_AMBIGUOUS_CONCEPTS[plain];
    if (amb && Array.isArray(amb.options) && amb.options.length) {
      ambiguousPantryItems.push({ index: idx, pantryItem: pItem, amb });
    }
  }

  if (!ambiguousPantryItems.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }

  box.replaceChildren();
  for (const { pantryItem, amb } of ambiguousPantryItems) {
    const group = node("div", "disambiguation-group");
    const rawDisplay = displayIngredient(pantryItem.name);
    const prompt = node(
      "p",
      "disambiguation-prompt",
      currentLocale === "en"
        ? `Select a specific ingredient to replace "${rawDisplay}":`
        : `Chọn nguyên liệu cụ thể để thay cho “${rawDisplay}”${pantryItem.quantity ? ` (${pantryItem.quantity})` : ""}:`
    );
    const pillsRow = node("div", "disambiguation-pills-row");
    for (const opt of amb.options) {
      const label = currentLocale === "en" ? (opt.display_name_en || opt.canonical_name) : opt.display_name_vi;
      const pill = node("button", "disambiguation-pill-btn", `+ ${label}`);
      pill.type = "button";
      pill.setAttribute("data-replace-canonical", opt.canonical_name);
      pill.addEventListener("click", () => {
        if (isLoading) return;
        const targetIdx = pantry.findIndex(x => x === pantryItem || x.name === pantryItem.name);
        const preservedQty = pantryItem.quantity || "";
        const replacementObj = {
          name: opt.canonical_name,
          source: "manual",
          count: 1,
          quantity: preservedQty,
          raw: preservedQty ? `${preservedQty} ${opt.display_name_vi}` : opt.display_name_vi,
          unrecognized: false,
        };
        const alreadyHasTarget = pantry.some((x, i) => i !== targetIdx && canonicalInput(x.name) === opt.canonical_name);
        if (targetIdx !== -1) {
          if (alreadyHasTarget) {
            pantry.splice(targetIdx, 1);
          } else {
            pantry.splice(targetIdx, 1, replacementObj);
          }
        } else if (!alreadyHasTarget && pantry.length < 100) {
          pantry.push(replacementObj);
        }
        ui.mappingNote.hidden = true;
        ui.mappingNote.textContent = "";
        pantryChanged();
        pantryUi.pantryNotice.textContent = currentLocale === "en"
          ? `Updated to "${label}". Click "Suggest recipes" to update.`
          : `Đã chọn “${label}”. Bấm “Gợi ý món ăn” để cập nhật kết quả.`;
      });
      pillsRow.append(pill);
    }
    group.append(prompt, pillsRow);
    box.append(group);
  }
  box.hidden = false;
}

buildCatalogItemsFromSource();

pantryUi.ingredientInput.addEventListener("input", () => {
  updateAutocompleteDropdown();
});

pantryUi.ingredientInput.addEventListener("keydown", event => {
  if (!modalUi.ingredientAutocomplete || modalUi.ingredientAutocomplete.hidden || !autocompleteSuggestions.length) {
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightAutocompleteRow(activeAutocompleteIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightAutocompleteRow(activeAutocompleteIndex - 1);
  } else if (event.key === "Enter" && activeAutocompleteIndex >= 0 && autocompleteSuggestions[activeAutocompleteIndex]) {
    event.preventDefault();
    commitAutocompleteSuggestion(autocompleteSuggestions[activeAutocompleteIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeAutocompleteDropdown();
  }
});

pantryUi.ingredientInput.addEventListener("blur", () => {
  setTimeout(() => {
    closeAutocompleteDropdown();
  }, 150);
});

modalUi.toggleCatalogBtn?.addEventListener("click", () => {
  toggleCatalogBrowser(undefined, modalUi.toggleCatalogBtn);
});

modalUi.closeCatalogBtn?.addEventListener("click", () => {
  toggleCatalogBrowser(false);
});

modalUi.doneCatalogBtn?.addEventListener("click", () => {
  toggleCatalogBrowser(false);
});

if (modalUi.catalogResultsScroll) {
  let catalogTouchStartY = 0;
  modalUi.catalogResultsScroll.addEventListener("wheel", event => {
    const el = modalUi.catalogResultsScroll;
    if (el.scrollHeight <= el.clientHeight) return;
    const atTop = el.scrollTop <= 0 && event.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && event.deltaY > 0;
    if (atTop || atBottom) {
      event.preventDefault();
    }
  }, { passive: false });
  modalUi.catalogResultsScroll.addEventListener("touchstart", event => {
    catalogTouchStartY = event.touches?.[0]?.clientY ?? 0;
  }, { passive: true });
  modalUi.catalogResultsScroll.addEventListener("touchmove", event => {
    const el = modalUi.catalogResultsScroll;
    if (el.scrollHeight <= el.clientHeight) return;
    const curY = event.touches?.[0]?.clientY ?? catalogTouchStartY;
    const deltaY = catalogTouchStartY - curY;
    const atTop = el.scrollTop <= 0 && deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && deltaY > 0;
    if (atTop || atBottom) {
      event.preventDefault();
    }
  }, { passive: false });
}

modalUi.catalogCategorySelect?.addEventListener("change", () => {
  activeCatalogCategory = modalUi.catalogCategorySelect.value || "all";
  catalogVisibleLimit = CATALOG_PAGE_SIZE;
  if (modalUi.catalogResultsScroll) modalUi.catalogResultsScroll.scrollTop = 0;
  renderCatalogCategoryTabs();
  renderCatalogBrowserGrid();
});

modalUi.catalogSearchInput?.addEventListener("input", () => {
  activeCatalogSearch = modalUi.catalogSearchInput.value || "";
  catalogVisibleLimit = CATALOG_PAGE_SIZE;
  if (modalUi.catalogSearchClearBtn) {
    modalUi.catalogSearchClearBtn.hidden = !activeCatalogSearch.trim();
  }
  if (modalUi.catalogResultsScroll) modalUi.catalogResultsScroll.scrollTop = 0;
  renderCatalogBrowserGrid();
});

modalUi.catalogSearchClearBtn?.addEventListener("click", () => {
  if (!modalUi.catalogSearchInput) return;
  modalUi.catalogSearchInput.value = "";
  activeCatalogSearch = "";
  catalogVisibleLimit = CATALOG_PAGE_SIZE;
  modalUi.catalogSearchClearBtn.hidden = true;
  renderCatalogBrowserGrid();
  modalUi.catalogSearchInput.focus?.();
});

modalUi.catalogLoadMoreBtn?.addEventListener("click", () => {
  catalogVisibleLimit += CATALOG_PAGE_SIZE;
  renderCatalogBrowserGrid({ preserveScroll: true });
});


let activeQuickItem = null;

function updateQuickPreview() {
  if (!activeQuickItem || !modalUi.quickPreviewText) return;
  const qty = (modalUi.quickQuantityInput?.value || "").trim() || activeQuickItem.defaultQty;
  modalUi.quickPreviewText.textContent = `Sẽ thêm: ${qty} ${activeQuickItem.name}`;
  for (const btn of (modalUi.quickPresetRow?.querySelectorAll?.(".quick-preset-btn") || [])) {
    btn.classList?.toggle("active", btn.getAttribute("data-preset") === qty);
  }
}

function stepQuickQuantity(delta) {
  if (!activeQuickItem || !modalUi.quickQuantityInput) return;
  const current = (modalUi.quickQuantityInput.value || "").trim() || activeQuickItem.defaultQty;
  const m = current.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  const unit = (m && m[2] ? m[2].trim() : activeQuickItem.unit || "quả");
  const isGram = /^(g|gr|gram)$/i.test(unit);
  const step = isGram ? 100 : 1;
  const minVal = isGram ? 100 : 1;
  const curNum = m ? Number(m[1].replace(",", ".")) : (isGram ? 200 : 1);
  const nextNum = Math.max(minVal, Math.round((curNum + delta * step) * 10) / 10);
  modalUi.quickQuantityInput.value = isGram ? `${nextNum}${unit}` : `${nextNum} ${unit}`.trim();
  updateQuickPreview();
}

function openQuickQuantitySelector(chipButton) {
  if (isLoading || !modalUi.quickQuantityPopover) return;
  const name = chipButton.getAttribute("data-quick-name") || chipButton.textContent.replace(/^\+\s*/, "").trim().toLowerCase();
  const label = chipButton.getAttribute("data-quick-label") || name;
  const unit = chipButton.getAttribute("data-quick-unit") || "quả";
  const defaultQty = chipButton.getAttribute("data-quick-default") || `2 ${unit}`;
  const presets = (chipButton.getAttribute("data-quick-presets") || defaultQty).split(",").map(s => s.trim()).filter(Boolean);

  activeQuickItem = { name, label, unit, defaultQty, presets, button: chipButton };
  for (const btn of (document.querySelectorAll?.(".quick-chip") || [])) {
    btn.classList?.toggle("active", btn === chipButton);
  }
  if (modalUi.quickSelectedName) modalUi.quickSelectedName.textContent = label;
  if (modalUi.quickPresetRow) {
    modalUi.quickPresetRow.replaceChildren();
    for (const preset of presets) {
      const pBtn = node("button", "quick-preset-btn", preset);
      pBtn.type = "button";
      pBtn.setAttribute("data-preset", preset);
      pBtn.addEventListener("click", () => {
        if (modalUi.quickQuantityInput) modalUi.quickQuantityInput.value = preset;
        updateQuickPreview();
      });
      modalUi.quickPresetRow.append(pBtn);
    }
  }
  if (modalUi.quickQuantityInput) {
    modalUi.quickQuantityInput.value = defaultQty;
  }
  modalUi.quickQuantityPopover.hidden = false;
  updateQuickPreview();
  modalUi.quickQuantityInput?.focus();
}

function closeQuickQuantitySelector() {
  activeQuickItem = null;
  if (modalUi.quickQuantityPopover) modalUi.quickQuantityPopover.hidden = true;
  for (const btn of (document.querySelectorAll?.(".quick-chip") || [])) {
    btn.classList?.remove("active");
  }
}

function commitQuickQuantityAdd() {
  if (!activeQuickItem || isLoading) return;
  const qty = (modalUi.quickQuantityInput?.value || "").trim() || activeQuickItem.defaultQty;
  const combined = `${qty} ${activeQuickItem.name}`.trim();
  closeQuickQuantitySelector();
  addManualIngredientsFromText(combined);
}

for (const chipButton of (document.querySelectorAll?.(".quick-chip") || [])) {
  chipButton.addEventListener("click", () => {
    if (isLoading) return;
    openQuickQuantitySelector(chipButton);
  });
}

modalUi.quickQtyMinus?.addEventListener("click", () => stepQuickQuantity(-1));
modalUi.quickQtyPlus?.addEventListener("click", () => stepQuickQuantity(1));
modalUi.quickQuantityInput?.addEventListener("input", updateQuickPreview);
modalUi.quickQuantityInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitQuickQuantityAdd();
  }
});
modalUi.confirmQuickAdd?.addEventListener("click", commitQuickQuantityAdd);
modalUi.cancelQuickAdd?.addEventListener("click", closeQuickQuantitySelector);

pantryUi.rankingMethodSelect?.addEventListener("change", () => {
  if (!appConfig) return;
  appConfig.ranking_method = pantryUi.rankingMethodSelect.value || "final";
  refreshGlobalLanguage();
  if (pantry.length) pantryUi.pantryNotice.textContent = "Đã chuyển cách gợi ý. Bấm “Gợi ý món ăn” để cập nhật kết quả.";
});

for (const radio of (document.querySelectorAll?.('input[name="rankingMethodRadio"]') || [])) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    if (pantryUi.rankingMethodSelect) pantryUi.rankingMethodSelect.value = radio.value;
    if (appConfig) appConfig.ranking_method = radio.value;
    refreshGlobalLanguage();
    if (pantry.length) pantryUi.pantryNotice.textContent = "Đã chuyển cách gợi ý. Bấm “Gợi ý món ăn” để cập nhật kết quả.";
  });
}

modalUi.methodInfoToggle?.addEventListener("click", () => {
  if (!modalUi.methodInfoPanel) return;
  const open = modalUi.methodInfoPanel.hidden;
  modalUi.methodInfoPanel.hidden = !open;
  modalUi.methodInfoToggle.setAttribute("aria-expanded", String(open));
});

modalUi.clearPantryButton?.addEventListener("click", () => {
  if (!modalUi.clearPantryPrompt || isLoading) return;
  modalUi.clearPantryPrompt.hidden = false;
  modalUi.cancelClearPantry?.focus();
});
modalUi.cancelClearPantry?.addEventListener("click", () => {
  if (!modalUi.clearPantryPrompt) return;
  modalUi.clearPantryPrompt.hidden = true;
  modalUi.clearPantryButton?.focus();
});
modalUi.confirmClearPantry?.addEventListener("click", () => {
  if (isLoading) return;
  pantry = [];
  confirmedStaples.clear();
  updateConfirmedStaplesUi();
  if (modalUi.clearPantryPrompt) modalUi.clearPantryPrompt.hidden = true;
  ui.mappingNote.hidden = true;
  ui.mappingNote.textContent = "";
  pantryChanged();
});

modalUi.openUploadBtn?.addEventListener("click", () => {
  toggleInlineImagePanel();
});
modalUi.closeUploadPanel?.addEventListener("click", () => {
  closeInlineImagePanel();
});
modalUi.openCameraBtn?.addEventListener("click", () => {
  if (isLoading) return;
  openAiModal("camera", modalUi.openCameraBtn);
  cameraController?.start();
});
modalUi.closeAiModal?.addEventListener("click", closeAiModal);
modalUi.doneAiModalBtn?.addEventListener("click", closeAiModal);
modalUi.aiModal?.addEventListener("click", event => {
  if (event.target === modalUi.aiModal) closeAiModal();
});

modalUi.navHomeBtn?.addEventListener("click", () => {
  closeAiModal();
  toggleCatalogBrowser(false);
  closeInlineImagePanel();
  switchPageView("home");
});
modalUi.brandHomeLink?.addEventListener("click", event => {
  event.preventDefault();
  closeAiModal();
  toggleCatalogBrowser(false);
  closeInlineImagePanel();
  switchPageView("home");
});
modalUi.navFavoritesBtn?.addEventListener("click", () => {
  closeAiModal();
  toggleCatalogBrowser(false);
  closeInlineImagePanel();
  switchPageView("favorites");
});
modalUi.navHistoryBtn?.addEventListener("click", () => {
  closeAiModal();
  toggleCatalogBrowser(false);
  closeInlineImagePanel();
  switchPageView("history");
});
modalUi.favoritesBackHomeBtn?.addEventListener("click", () => {
  closeInlineImagePanel();
  switchPageView("home");
});
modalUi.historyBackHomeBtn?.addEventListener("click", () => {
  closeInlineImagePanel();
  switchPageView("home");
});

if (modalUi.unifiedInputDropTarget) {
  for (const eventName of ["dragenter", "dragover"]) {
    modalUi.unifiedInputDropTarget.addEventListener(eventName, event => {
      event.preventDefault();
      if (!canDetectImages()) return;
      modalUi.unifiedInputDropTarget.classList.add("dragover");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    modalUi.unifiedInputDropTarget.addEventListener(eventName, event => {
      event.preventDefault();
      modalUi.unifiedInputDropTarget.classList.remove("dragover");
    });
  }
  modalUi.unifiedInputDropTarget.addEventListener("drop", event => {
    if (!canDetectImages()) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    toggleInlineImagePanel(true);
    selectFile(file);
    if (selectedFile === file) {
      if (typeof ui.form.requestSubmit === "function") ui.form.requestSubmit();
      else ui.form.dispatchEvent(new Event("submit", {cancelable: true}));
    }
  });
}
pantryUi.recommendButton.addEventListener("click", async () => {
  if (isLoading || !appConfig || !pantry.length) return;
  const request = beginActionRequest('recommend');
  pantryUi.recommendButton.textContent = "Đang gợi ý...";
  showResultBanner('loading', currentLocale === 'en' ? 'Finding matching recipes...' : 'Đang tìm công thức phù hợp...');
  try {
    const confirmedList = getConfirmedStaples();
    const {response, data} = await actionResponseJson(request, "/api/recommend", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ingredients: pantry.map(x => x.name), top_n: appConfig.top_n,
        two_tier: true,
        confirmed_staples: confirmedList,
        ...(pantryUi.rankingMethodSelect?.value ? {ranking_method: pantryUi.rankingMethodSelect.value} : {}),
        ...(needsConfirmation()?{confirmed:true}:{})})});
    if (!ownsActionRequest(request)) return;
    if (!response.ok || !data.success) throw new Error(data.message || "Nguyên liệu không hợp lệ. Hãy kiểm tra lại danh sách.");
    showResultBanner(null);
    if (data.ranking_method && appConfig) { appConfig.ranking_method = data.ranking_method; refreshGlobalLanguage(); }
    hasRecommendedForPantry = true;
    lastRecommendResponseMeta = {
      empty_reason: data.empty_reason || null,
      empty_detail: data.empty_detail || null,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      unresolved_ingredients: Array.isArray(data.unresolved_ingredients) ? data.unresolved_ingredients : [],
      staple_policy: data.staple_policy || null,
      two_tier: data.two_tier === true,
      tier_a_recommendations: Array.isArray(data.tier_a_recommendations) ? data.tier_a_recommendations : null,
      tier_b_recommendations: Array.isArray(data.tier_b_recommendations) ? data.tier_b_recommendations : null,
      tier_summary: data.tier_summary || null,
    };
    currentRecipes = (data.two_tier === true && Array.isArray(data.tier_a_recommendations) && Array.isArray(data.tier_b_recommendations))
      ? [...data.tier_a_recommendations, ...data.tier_b_recommendations]
      : data.recommendations;
    renderRecipes(currentRecipes, ui.recipeList);
    ui.mappingNote.hidden = true;
    pantryUi.pantryNotice.textContent = (!currentRecipes.length && data.empty_detail && !(data.unresolved_ingredients || []).length)
      ? (currentLocale === 'en'
        ? (data.empty_detail.explanation_en || displayWarnings(data.warnings))
        : (data.empty_detail.explanation_vi || displayWarnings(data.warnings)))
      : data.warnings.length ? displayWarnings(data.warnings)
      : currentRecipes.length ? "Đã gợi ý theo danh sách nguyên liệu hiện tại."
      : (data.empty_detail?.explanation_vi || "Chưa có công thức đạt độ khớp. Kiểm tra danh sách hoặc thêm nguyên liệu bạn có rồi gợi ý lại.");
    ui.timing.textContent = `Gợi ý ${Math.round(data.timing_ms.request)} ms`;
    saveHistory("recommend");
  } catch (error) {
    if (ownsActionRequest(request)) showActionFailure(request, error);
  } finally {
    finishActionRequest(request);
  }
});
pantryUi.clearHistory.addEventListener("click", () => {
  pantryUi.clearHistoryPrompt.hidden = false;
  pantryUi.cancelClearHistory.focus();
});
pantryUi.cancelClearHistory.addEventListener("click", () => {
  pantryUi.clearHistoryPrompt.hidden = true;
  pantryUi.clearHistory.focus();
});
pantryUi.confirmClearHistory.addEventListener("click", () => {
  history = [];
  pantryUi.clearHistoryPrompt.hidden = true;
  persist(HISTORY_KEY, history);
  renderHistory();
});
pantryUi.favoriteList.append(node("p", "privacy-note", "Đang tải công thức đã lưu..."));
pantryUi.historyList.append(node("p", "privacy-note", "Đang tải lịch sử..."));

ui.input.addEventListener("change", () => {
  const file = ui.input.files[0];
  const shouldAutoAnalyze = autoAnalyzeOnPick;
  autoAnalyzeOnPick = false;
  if (!file) return;
  toggleInlineImagePanel(true);
  selectFile(file);
  if (shouldAutoAnalyze && selectedFile === file) {
    if (typeof ui.form.requestSubmit === "function") ui.form.requestSubmit();
    else ui.form.dispatchEvent(new Event("submit", {cancelable: true}));
  }
});
ui.remove.addEventListener("click", resetSelection);
for (const eventName of ["dragenter", "dragover"]) {
  ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropzone.classList.add("dragover");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropzone.classList.remove("dragover");
  });
}
ui.dropzone.addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isLoading) return;
  if (cameraController && ["opening", "live", "capturing"].includes(cameraController.state)) {
    cameraNotice("Hãy chụp ảnh hoặc tắt camera trước khi phân tích ảnh đã chọn.");
    return;
  }
  if (!selectedFile) {
    showStatus("error", "Vui lòng chọn ảnh.");
    return;
  }
  const error = validateFile(selectedFile);
  if (error) {
    showStatus("error", error);
    return;
  }
  const session = ++analyzeSessionId;
  const request = beginActionRequest('analyze');
  ui.buttonLabel.textContent = "Đang phân tích ảnh...";
  showStatus("loading", precisionGuard() ? "Đang phân tích ảnh..." : "Đang phân tích ảnh và tìm món phù hợp...");
  const analysisFile=selectedFile,requestStartedAt=new Date().toISOString();
  diagnosticExporter?.begin(analysisFile);
  try {
    const body = new FormData();
    body.append("image", selectedFile, selectedFile.name);
    const headers = appConfig?.scope?.profile === 'fridge11'
      ? {'X-Smart-Kitchen-Empty-Result': 'success-v1'} : {};
    const {response, data} = await actionResponseJson(request, "/api/analyze", { method: "POST", headers, body });
    if (!ownsActionRequest(request) || analyzeSessionId !== session) return;
    diagnosticExporter?.record(analysisFile,response.status,data,requestStartedAt);
    if (!response.ok || !data.success) {
      // Keep existing valid pantry/recommendations/overlay when a new request fails.
      if (!request.hadResults && !precisionGuard()) stillOverlay?.set(data.detection);
      showActionFailure(request, new Error(data.message || "Có lỗi xảy ra, vui lòng thử lại."));
      offerManualPantry(data);
      return;
    }
    if (!precisionGuard()) stillOverlay?.set(data.detection);
    renderResult(data);
  } catch (error) {
    if (ownsActionRequest(request) && analyzeSessionId === session) showActionFailure(request, error);
  } finally {
    finishActionRequest(request);
  }
});

fetch("/api/config")
  .then((response) => {
    if (!response.ok) throw new Error("config unavailable");
    return response.json();
  })
  .then((config) => {
    appConfig = config;
    if (modalUi.openUploadBtn) modalUi.openUploadBtn.hidden = !canDetectImages();
    if (modalUi.openCameraBtn) modalUi.openCameraBtn.hidden = !canDetectImages();
    if (pantryUi.rankingMethodSelect && config.ranking_method) pantryUi.rankingMethodSelect.value = config.ranking_method;
    if (recipeFirst()) {
      const workspace = document.getElementById('ingredientWorkspace');
      workspace.classList.add('recipe-first');
      if (!config.image_detection_available) workspace.classList.add('recipe-only');
      else workspace.classList.remove('recipe-only');
      document.getElementById('resultBadge').hidden = true;
      pantryUi.pantryNotice.textContent = '';
      pantryUi.addIngredientForm.hidden = false;
      pantryUi.showAddIngredient.setAttribute('aria-expanded', 'true');
      ui.status.hidden = true;
      ui.results.hidden = false;
    }
    if (config.localization) {
      const local = config.localization;
      const trustedDisplay = local.display_policy === "reviewed_or_source_english";
      localizationData = {...local, ingredients: trustedDisplay ? local.ingredients : {},
        recipe_titles: trustedDisplay ? local.recipe_titles : {}};
      rebuildDiacriticFreeAliases();
      if (typeof buildCatalogItemsFromSource === "function") buildCatalogItemsFromSource();
      if (typeof syncCatalogPantryState === "function") syncCatalogPantryState();
      if (!trustedDisplay) pantryUi.storageNotice.textContent = currentLocale === "en"
        ? "Using temporary display data; keeping original English names for accuracy."
        : "Đang dùng dữ liệu hiển thị tạm; giữ tên gốc tiếng Anh để đảm bảo chính xác.";
    }
    ui.maxFileLabel.textContent = String(config.max_upload_mb);
    updateCameraControls();
    renderPantry();
    renderRecipes(currentRecipes, ui.recipeList);
    renderRecipes(favorites, pantryUi.favoriteList);
    renderHistory();
    refreshGlobalLanguage();
    fetch('/api/display-catalog').then(response=>{if(!response.ok)throw Error('catalog');return response.json();}).then(catalog=>{
      if(!catalog || !catalog.recipes || typeof catalog.recipes!=='object' || !catalog.coverage || typeof catalog.coverage!=='object')throw Error('invalid display catalog');
      displayCatalog=catalog;
      displayTitlesByName={};for(const meta of Object.values(catalog.recipes||{}))if(meta.title)displayTitlesByName[meta.source_name]=meta;
      const c=catalog.coverage||{};
      document.getElementById('translationCoverage').textContent = currentLocale === 'en'
        ? `Localized in Vietnamese: ${c.fully_localized_vi||0}/${c.total_records||0} recipes.`
        : `Đã Việt hóa đầy đủ ${c.fully_localized_vi||0}/${c.total_records||0} công thức.`;
      refreshGlobalLanguage();
    }).catch(()=>{});
  })
  .catch(() => showStatus("error", "Không tải được cấu hình ứng dụng. Vui lòng thử lại."));
