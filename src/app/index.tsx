import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '@/firebase';

type Product = { name: string; price: number; soluong: number; image: string };
type ProductRecord = Product & { id: string };
type ProductForm = { name: string; price: string; soluong: string; image: string };
type Page = 'list' | 'detail' | 'form' | 'login';
type SortField = 'name' | 'price' | 'soluong';
type StockFilter = 'all' | 'available' | 'low' | 'out';
type ProductFilters = { sortField: SortField; direction: 'asc' | 'desc'; stock: StockFilter; minPrice: string; maxPrice: string };

const defaultFilters: ProductFilters = { sortField: 'name', direction: 'asc', stock: 'all', minPrice: '', maxPrice: '' };
const sortOptions: { value: SortField; label: string }[] = [
  { value: 'name', label: 'Tên sản phẩm' },
  { value: 'price', label: 'Giá' },
  { value: 'soluong', label: 'Số lượng' },
];
const stockOptions: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'available', label: 'Còn hàng' },
  { value: 'low', label: 'Sắp hết (1–5)' },
  { value: 'out', label: 'Hết hàng' },
];

const C = {
  bg: '#F6F7FB', surface: '#FFFFFF', ink: '#19233B', muted: '#77839A',
  line: '#E5E9F1', blue: '#2D43A5', blueSoft: '#EEF1FF', red: '#D43D4C',
  green: '#168453', pale: '#F8F9FC',
};

const formatPrice = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;

function ProductImage({ product, height = 132 }: { product: Product; height?: number }) {
  return product.image ? (
    <Image source={{ uri: product.image }} style={{ width: '100%', height }} resizeMode="cover" />
  ) : (
    <View style={[styles.imagePlaceholder, { height }]}>
      <Text style={styles.placeholderIcon}>▧</Text>
      <Text style={styles.placeholderText}>Chưa có ảnh</Text>
    </View>
  );
}

function Button({
  title,
  onPress,
  tone = 'primary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' ? styles.primaryButton : tone === 'danger' ? styles.dangerButton : styles.outlineButton,
        pressed && styles.pressed,
        disabled && styles.disabledButton,
      ]}>
      <Text style={[styles.buttonText, tone === 'outline' && styles.outlineButtonText]}>{title}</Text>
    </Pressable>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad' | 'numeric';
  suffix?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#A0A9B9"
          keyboardType={keyboardType}
          style={styles.input}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const columns = width >= 1200 ? 3 : width >= 760 ? 2 : 1;
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [page, setPage] = useState<Page>('login');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ProductFilters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<ProductFilters>(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>({ name: '', price: '', soluong: '', image: '' });
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Đang kết nối Firestore…');
  const [busy, setBusy] = useState(false);

  const refreshProducts = useCallback(async () => {
    const snapshot = await getDocs(collection(db, 'products'));
    const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ProductRecord);
    setProducts(records);
    setConnectionStatus(`Firestore · ${records.length} sản phẩm`);
    return records;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const authenticated = Boolean(user);
      setSignedIn(authenticated);
      setPage(authenticated ? 'list' : 'login');
      setAuthReady(true);

      if (authenticated) {
        setConnectionStatus('Đang kết nối Firestore…');
        void refreshProducts().catch((error: { code?: string }) => {
          setConnectionStatus(error.code === 'permission-denied'
            ? 'Không có quyền truy cập Firestore'
            : 'Không kết nối được Firestore');
        });
      } else {
        setProducts([]);
        setConnectionStatus('Đăng nhập để xem sản phẩm');
      }
    });
    return unsubscribe;
  }, [refreshProducts]);

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    const minimum = filters.minPrice.trim() ? Number(filters.minPrice) : null;
    const maximum = filters.maxPrice.trim() ? Number(filters.maxPrice) : null;
    return products
      .map((product, index) => ({ product, index }))
      .filter(({ product }) => {
        if (!product.name.toLocaleLowerCase('vi').includes(normalized)) return false;
        if (minimum !== null && Number.isFinite(minimum) && product.price < minimum) return false;
        if (maximum !== null && Number.isFinite(maximum) && product.price > maximum) return false;
        if (filters.stock === 'available' && product.soluong <= 0) return false;
        if (filters.stock === 'low' && (product.soluong <= 0 || product.soluong > 5)) return false;
        if (filters.stock === 'out' && product.soluong > 0) return false;
        return true;
      })
      .sort((a, b) => {
        const result = filters.sortField === 'name'
          ? a.product.name.localeCompare(b.product.name, 'vi')
          : filters.sortField === 'price'
            ? a.product.price - b.product.price
            : a.product.soluong - b.product.soluong;
        return filters.direction === 'asc' ? result : -result;
      });
  }, [products, query, filters]);

  const activeFilterCount = Number(filters.stock !== 'all')
    + Number(filters.minPrice.trim() !== '')
    + Number(filters.maxPrice.trim() !== '');

  function openFilters() {
    setDraftFilters(filters);
    setFiltersOpen(true);
  }

  function startCreate() {
    setEditingIndex(null);
    setForm({ name: '', price: '', soluong: '', image: '' });
    setPage('form');
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setSelectedIndex(index);
    setForm({ ...products[index], price: String(products[index].price), soluong: String(products[index].soluong) });
    setPage('form');
  }

  async function saveProduct() {
    const name = form.name.trim();
    const numericPrice = Number(form.price);
    const numericQuantity = Number(form.soluong);
    if (!name) return Alert.alert('Thiếu tên sản phẩm', 'Hãy nhập tên sản phẩm.');
    if (!form.price.trim() || !Number.isFinite(numericPrice) || numericPrice < 0) {
      return Alert.alert('Giá chưa hợp lệ', 'Giá phải là số lớn hơn hoặc bằng 0.');
    }
    if (!form.soluong.trim() || !Number.isInteger(numericQuantity) || numericQuantity < 0) {
      return Alert.alert('Số lượng chưa hợp lệ', 'Số lượng phải là số nguyên lớn hơn hoặc bằng 0.');
    }
    const record: Product = { name, price: numericPrice, soluong: numericQuantity, image: form.image };
    setBusy(true);
    try {
      let id: string;
      if (editingIndex === null) {
        const result = await addDoc(collection(db, 'products'), record);
        id = result.id;
      } else {
        id = products[editingIndex].id;
        await updateDoc(doc(db, 'products', id), record);
      }
      const loaded = await refreshProducts();
      setSelectedIndex(loaded.findIndex((item) => item.id === id));
      setConnectionStatus('Đã lưu sản phẩm vào Firestore và tải lại danh sách.');
      setPage('detail');
    } catch (error) {
      const code = (error as { code?: string }).code;
      setConnectionStatus(code === 'permission-denied'
        ? 'Không có quyền ghi Firestore · kiểm tra Security Rules'
        : `Không lưu được sản phẩm (${code ?? 'lỗi kết nối'})`);
      Alert.alert('Không lưu được sản phẩm', code === 'permission-denied'
        ? 'Firestore từ chối ghi. Kiểm tra Rules của collection products.'
        : 'Kiểm tra kết nối và thử lại.');
    } finally {
      setBusy(false);
    }
  }

  function removeProduct(index: number) {
    const remove = async () => {
      try {
        await deleteDoc(doc(db, 'products', products[index].id));
        await refreshProducts();
        setSelectedIndex(null);
        setPage('list');
      } catch (error) {
        const code = (error as { code?: string }).code;
        setConnectionStatus(`Không xóa được sản phẩm (${code ?? 'lỗi kết nối'})`);
      }
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Xóa sản phẩm “${products[index].name}”?`)) remove();
      return;
    }
    Alert.alert('Xóa sản phẩm?', `Bạn có chắc muốn xóa “${products[index].name}”?`, [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa', style: 'destructive', onPress: () => { void remove(); } },
    ]);
  }

  async function chooseImage(camera: boolean) {
    setPhotoSheetOpen(false);
    if (camera && Platform.OS === 'web') {
      Alert.alert('Không hỗ trợ camera', 'Trên web, hãy chọn ảnh từ thư viện.');
      return;
    }
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Cần cấp quyền', 'Hãy cho phép ứng dụng truy cập camera hoặc thư viện ảnh.');
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.35, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.35, base64: true });
    const asset = !result.canceled ? result.assets[0] : undefined;
    if (asset?.base64) {
      const dataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      if (dataUri.length > 700_000) {
        Alert.alert('Ảnh quá lớn', 'Chọn ảnh nhỏ hơn để nằm trong giới hạn kích thước của một document Firestore.');
        return;
      }
      setForm((current) => ({ ...current, image: dataUri }));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      {!authReady && (
        <View style={styles.authLoading}>
          <View style={styles.loginLogo}><Text style={styles.loginLogoText}>P</Text></View>
          <Text style={styles.authLoadingTitle}>Quản lý sản phẩm</Text>
          <Text style={styles.authLoadingText}>Đang kiểm tra phiên đăng nhập…</Text>
        </View>
      )}

      {authReady && page === 'list' && (
        <>
          <View style={styles.topbar}>
            <View style={styles.brandIcon}><Text style={styles.brandIconText}>P</Text></View>
            <View style={styles.topTitleBlock}>
              <Text style={styles.pageTitle}>Sản phẩm</Text>
              <Text style={styles.countBadge}>{products.length}</Text>
            </View>
            <Pressable onPress={() => setPage('login')} style={styles.headerAction}>
              <Text style={styles.headerActionText}>{signedIn ? 'Admin' : 'Đăng nhập'}</Text>
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Tìm theo tên sản phẩm..."
              placeholderTextColor="#929DB0"
              style={styles.searchInput}
            />
            <Pressable accessibilityLabel="Mở bộ lọc và sắp xếp" onPress={openFilters} style={styles.sortButton}>
              <Text style={styles.sortText}>☷ Lọc{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}</Text>
            </Pressable>
          </View>

          <View style={styles.listMeta}>
            <Text style={styles.metaText}>Danh sách sản phẩm</Text>
            <Text numberOfLines={1} style={styles.metaRight}>{connectionStatus}</Text>
          </View>

          <ScrollView contentContainerStyle={[styles.listContent, columns > 1 && styles.listContentGrid]} keyboardShouldPersistTaps="handled">
            {visibleProducts.map(({ product, index }) => (
              <Pressable
                key={`${index}-${product.name}`}
                onPress={() => { setSelectedIndex(index); setPage('detail'); }}
                style={({ pressed }) => [
                  styles.productCard,
                  columns > 1 && styles.productCardGrid,
                  { width: columns === 3 ? '32%' : columns === 2 ? '48.7%' : '100%' },
                  pressed && styles.pressed,
                ]}>
                <View style={[styles.cardImageWrap, columns > 1 && styles.cardImageWrapGrid]}><ProductImage product={product} height={columns > 1 ? 168 : 112} /></View>
                <View style={styles.productInfo}>
                  <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productPrice}>{formatPrice(product.price)}</Text>
                  <View style={styles.stockRow}>
                    <Text style={styles.stockLabel}>Còn hàng</Text>
                    <Text style={styles.stockValue}>{product.soluong}</Text>
                  </View>
                </View>
                <View style={[styles.cardActions, columns > 1 && styles.cardActionsGrid]}>
                  <Pressable accessibilityLabel="Sửa sản phẩm" onPress={() => startEdit(index)} hitSlop={7} style={styles.rowAction}>
                    <Text style={styles.editActionText}>Sửa</Text>
                  </Pressable>
                  <Pressable accessibilityLabel="Xóa sản phẩm" onPress={() => removeProduct(index)} hitSlop={7} style={styles.rowAction}>
                    <Text style={styles.deleteActionText}>Xóa</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
            {visibleProducts.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>▧</Text>
                <Text style={styles.emptyTitle}>Chưa có sản phẩm phù hợp</Text>
                <Text style={styles.emptySubtitle}>Thử từ khóa khác hoặc thêm sản phẩm mới.</Text>
              </View>
            )}
            <Text style={styles.listFootnote}>Chạm vào sản phẩm để xem chi tiết</Text>
          </ScrollView>

          <Pressable accessibilityLabel="Thêm sản phẩm" onPress={startCreate} style={({ pressed }) => [styles.fab, pressed && styles.pressed]}>
            <Text style={styles.fabText}>＋</Text>
          </Pressable>
        </>
      )}

      {authReady && page === 'detail' && selectedIndex !== null && products[selectedIndex] && (
        <>
          <View style={styles.subHeader}>
            <Pressable onPress={() => setPage('list')} style={styles.backButton}><Text style={styles.backGlyph}>‹</Text></Pressable>
            <Text style={styles.subTitle}>Chi tiết sản phẩm</Text>
            <Text style={styles.readOnlyBadge}>CHI TIẾT</Text>
          </View>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailHero}>
              <View style={styles.detailImage}><ProductImage product={products[selectedIndex]} height={224} /></View>
              <Text style={styles.detailName}>{products[selectedIndex].name}</Text>
              <Text style={styles.detailPrice}>{formatPrice(products[selectedIndex].price)}</Text>
            </View>
            <View style={styles.attributesCard}>
              <Text style={styles.sectionEyebrow}>THÔNG TIN SẢN PHẨM (4 TRƯỜNG)</Text>
              <View style={styles.attributeRow}><Text style={styles.attributeIcon}>▤</Text><View><Text style={styles.attributeLabel}>TÊN SẢN PHẨM</Text><Text style={styles.attributeValue}>{products[selectedIndex].name}</Text></View></View>
              <View style={styles.attributeRow}><Text style={styles.attributeIcon}>₫</Text><View><Text style={styles.attributeLabel}>GIÁ SẢN PHẨM</Text><Text style={styles.attributeValue}>{formatPrice(products[selectedIndex].price)}</Text></View></View>
              <View style={styles.attributeRow}><Text style={styles.attributeIcon}>▦</Text><View><Text style={styles.attributeLabel}>SỐ LƯỢNG</Text><Text style={styles.attributeValue}>{products[selectedIndex].soluong} sản phẩm</Text></View></View>
              <View style={[styles.attributeRow, styles.lastAttribute]}><Text style={styles.attributeIcon}>▧</Text><View><Text style={styles.attributeLabel}>HÌNH ẢNH</Text><Text style={styles.attributeValue}>{products[selectedIndex].image ? 'Đã có hình ảnh' : 'Chưa có hình ảnh'}</Text></View></View>
            </View>
            <Button title="✎   Sửa sản phẩm" onPress={() => startEdit(selectedIndex)} />
            <Button title="⌫   Xóa sản phẩm" tone="outline" onPress={() => removeProduct(selectedIndex)} />
          </ScrollView>
        </>
      )}

      {authReady && page === 'form' && (
        <>
          <View style={styles.subHeader}>
            <Pressable onPress={() => setPage(editingIndex === null ? 'list' : 'detail')} style={styles.backButton}><Text style={styles.backGlyph}>‹</Text></Pressable>
            <Text style={styles.subTitle}>{editingIndex === null ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}</Text>
            {editingIndex === null
              ? <Pressable onPress={() => setForm({ name: '', price: '', soluong: '', image: '' })}><Text style={styles.resetAction}>Đặt lại</Text></Pressable>
              : <Text style={styles.readOnlyBadge}>CHỈNH SỬA</Text>}
          </View>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Pressable onPress={() => setPhotoSheetOpen(true)} style={styles.photoPicker}>
                <View style={styles.photoFrame}>
                  {form.image
                    ? <Image source={{ uri: form.image }} style={styles.formPhoto} resizeMode="cover" />
                    : <View style={styles.formPhotoPlaceholder}><Text style={styles.placeholderIcon}>▧</Text></View>}
                  <View style={styles.cameraBadge}><Text style={styles.cameraBadgeText}>＋</Text></View>
                </View>
                <Text style={styles.photoTitle}>{editingIndex === null ? 'Chạm để thêm hình ảnh' : 'Thay đổi hình ảnh'}</Text>
                <Text style={styles.photoHint}>Hình ảnh sản phẩm · JPG, PNG</Text>
              </Pressable>

              <View style={styles.formCard}>
                <FormField label="Tên sản phẩm *" value={form.name} onChangeText={(name) => setForm((current) => ({ ...current, name }))} placeholder="Nhập tên sản phẩm" />
                <FormField label="Giá sản phẩm *" value={form.price} onChangeText={(price) => setForm((current) => ({ ...current, price: price.replace(/[^\d.]/g, '') }))} placeholder="Ví dụ: 250000" keyboardType="decimal-pad" suffix="₫" />
                <FormField label="Số lượng *" value={form.soluong} onChangeText={(soluong) => setForm((current) => ({ ...current, soluong: soluong.replace(/\D/g, '') }))} placeholder="Nhập số lượng tồn kho" keyboardType="numeric" suffix="sản phẩm" />
              </View>
              <Text style={styles.onlyFieldsNote}>Dữ liệu sản phẩm gồm đúng 4 trường: name, price, soluong, image.</Text>
              <Button
                title={busy ? 'Đang lưu…' : editingIndex === null ? '✓   Lưu sản phẩm' : '✓   Cập nhật sản phẩm'}
                onPress={() => { void saveProduct(); }}
                disabled={busy}
              />
              {editingIndex !== null && <Pressable onPress={() => setPage('detail')} style={styles.cancelLink}><Text style={styles.cancelText}>Hủy thay đổi</Text></Pressable>}
            </ScrollView>
          </KeyboardAvoidingView>
        </>
      )}

      {authReady && page === 'login' && (
        <>
          <View style={styles.subHeader}>
            {signedIn
              ? <Pressable onPress={() => setPage('list')} style={styles.backButton}><Text style={styles.backGlyph}>‹</Text></Pressable>
              : <View style={styles.backButton} />}
            <Text style={styles.subTitle}>Đăng nhập quản trị</Text>
            <Text style={styles.readOnlyBadge}>ADMIN</Text>
          </View>
          <KeyboardAvoidingView style={styles.loginPage} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
              <View style={styles.loginLogo}><Text style={styles.loginLogoText}>P</Text></View>
              <Text style={styles.loginTitle}>Quản lý sản phẩm</Text>
              <Text style={styles.loginSubtitle}>Đăng nhập để tiếp tục vào khu vực quản trị</Text>
              <View style={styles.loginCard}>
                <FormField label="Email" value={email} onChangeText={setEmail} placeholder="admin@example.com" />
                <FormField label="Mật khẩu" value={password} onChangeText={setPassword} placeholder="Nhập mật khẩu" />
                <Button title={signedIn ? 'Đăng xuất' : 'Đăng nhập   →'} onPress={() => {
                  void (async () => {
                    if (signedIn) {
                      await signOut(auth);
                      setPassword('');
                      return;
                    }
                    if (!email.trim() || !password) {
                      Alert.alert('Thiếu thông tin', 'Nhập email và mật khẩu của tài khoản đã tạo trong Firebase Authentication.');
                      return;
                    }
                    try {
                      await signInWithEmailAndPassword(auth, email.trim(), password);
                      setPassword('');
                    } catch (error) {
                      const code = (error as { code?: string }).code;
                      setConnectionStatus(`Đăng nhập thất bại (${code ?? 'lỗi xác thực'})`);
                      Alert.alert('Đăng nhập thất bại', 'Kiểm tra Email/Password provider và tài khoản trong Firebase Authentication.');
                    }
                  })();
                }} />
              </View>
              <Text style={styles.loginFootnote}>Dùng tài khoản đã tạo trong Firebase Authentication.</Text>
            </ScrollView>
          </KeyboardAvoidingView>
        </>
      )}

      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable
          style={[styles.modalBackdrop, width >= 760 && styles.centeredBackdrop]}
          onPress={() => setFiltersOpen(false)}>
          <View
            style={[styles.filterSheet, width >= 760 && styles.filterDialog]}
            onStartShouldSetResponder={() => true}>
            {width < 760 && <View style={styles.sheetHandle} />}
            <View style={styles.filterHeader}>
              <View>
                <Text style={styles.filterTitle}>Lọc và sắp xếp</Text>
                <Text style={styles.filterSubtitle}>Thu hẹp danh sách sản phẩm</Text>
              </View>
              <Pressable accessibilityLabel="Đóng bộ lọc" onPress={() => setFiltersOpen(false)} style={styles.closeFilter}>
                <Text style={styles.closeFilterText}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.filterLabel}>SẮP XẾP THEO</Text>
            <View style={styles.filterChipRow}>
              {sortOptions.map((option) => {
                const selected = draftFilters.sortField === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setDraftFilters((current) => ({ ...current, sortField: option.value }))}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}>
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setDraftFilters((current) => ({ ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }))}
              style={styles.directionButton}>
              <Text style={styles.directionIcon}>{draftFilters.direction === 'asc' ? '↑' : '↓'}</Text>
              <Text style={styles.directionText}>{draftFilters.direction === 'asc' ? 'Tăng dần' : 'Giảm dần'}</Text>
              <Text style={styles.directionHint}>Chạm để đổi chiều</Text>
            </Pressable>

            <Text style={styles.filterLabel}>TÌNH TRẠNG TỒN KHO</Text>
            <View style={styles.filterChipRow}>
              {stockOptions.map((option) => {
                const selected = draftFilters.stock === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setDraftFilters((current) => ({ ...current, stock: option.value }))}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}>
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.filterLabel}>KHOẢNG GIÁ (₫)</Text>
            <View style={styles.priceRangeRow}>
              <TextInput
                value={draftFilters.minPrice}
                onChangeText={(minPrice) => setDraftFilters((current) => ({ ...current, minPrice: minPrice.replace(/[^\d]/g, '') }))}
                placeholder="Giá thấp nhất"
                placeholderTextColor="#9AA5B7"
                keyboardType="numeric"
                style={styles.priceRangeInput}
              />
              <Text style={styles.priceRangeSeparator}>đến</Text>
              <TextInput
                value={draftFilters.maxPrice}
                onChangeText={(maxPrice) => setDraftFilters((current) => ({ ...current, maxPrice: maxPrice.replace(/[^\d]/g, '') }))}
                placeholder="Giá cao nhất"
                placeholderTextColor="#9AA5B7"
                keyboardType="numeric"
                style={styles.priceRangeInput}
              />
            </View>

            <View style={styles.filterFooter}>
              <Pressable
                onPress={() => { setFilters(defaultFilters); setDraftFilters(defaultFilters); setFiltersOpen(false); }}
                style={styles.clearFiltersButton}>
                <Text style={styles.clearFiltersText}>Xóa bộ lọc</Text>
              </Pressable>
              <Pressable
                onPress={() => { setFilters(draftFilters); setFiltersOpen(false); }}
                style={styles.applyFiltersButton}>
                <Text style={styles.applyFiltersText}>Áp dụng</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={photoSheetOpen} transparent animationType="fade" onRequestClose={() => setPhotoSheetOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPhotoSheetOpen(false)}>
          <View style={styles.photoSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Hình ảnh sản phẩm</Text>
            {Platform.OS !== 'web' && <Pressable onPress={() => chooseImage(true)} style={styles.sheetOption}><Text style={styles.sheetIcon}>◎</Text><Text style={styles.sheetOptionText}>Chụp ảnh</Text></Pressable>}
            <Pressable onPress={() => chooseImage(false)} style={styles.sheetOption}><Text style={styles.sheetIcon}>▧</Text><Text style={styles.sheetOptionText}>Chọn từ thư viện</Text></Pressable>
            {form.image ? <Pressable onPress={() => { setForm((current) => ({ ...current, image: '' })); setPhotoSheetOpen(false); }} style={styles.sheetOption}><Text style={[styles.sheetIcon, styles.removeIcon]}>×</Text><Text style={styles.removeText}>Xóa hình ảnh</Text></Pressable> : null}
            <Pressable onPress={() => setPhotoSheetOpen(false)} style={styles.sheetCancel}><Text style={styles.cancelText}>Đóng</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 1320, alignSelf: 'center', backgroundColor: C.bg },
  authLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  authLoadingTitle: { color: C.ink, fontSize: 18, fontWeight: '800' },
  authLoadingText: { color: C.muted, fontSize: 12, marginTop: 7 },
  flex: { flex: 1 },
  topbar: { height: 60, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  brandIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue },
  brandIconText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  topTitleBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle: { color: C.ink, fontSize: 18, fontWeight: '800' },
  countBadge: { overflow: 'hidden', color: C.blue, backgroundColor: C.blueSoft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: '800' },
  headerAction: { paddingHorizontal: 8, paddingVertical: 8 },
  headerActionText: { color: C.blue, fontSize: 11, fontWeight: '700' },
  searchRow: { marginHorizontal: 15, marginTop: 14, height: 46, borderRadius: 14, backgroundColor: C.blueSoft, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  searchIcon: { color: C.blue, fontSize: 23, marginRight: 7 },
  searchInput: { flex: 1, minWidth: 0, color: C.ink, fontSize: 13, paddingVertical: 8 },
  sortButton: { paddingHorizontal: 6, paddingVertical: 8 },
  sortText: { color: C.blue, fontSize: 11, fontWeight: '800' },
  listMeta: { height: 40, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaText: { color: C.ink, fontSize: 11, fontWeight: '700' },
  metaRight: { maxWidth: '58%', color: C.muted, fontSize: 10, textAlign: 'right' },
  listContent: { paddingHorizontal: 13, paddingTop: 2, paddingBottom: 100, gap: 11 },
  listContentGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'flex-start', paddingHorizontal: 22, rowGap: 16 },
  productCard: { minHeight: 125, borderRadius: 7, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', padding: 9, gap: 11 },
  productCardGrid: { minHeight: 278, alignItems: 'stretch', flexDirection: 'column', padding: 11, gap: 10 },
  cardImageWrap: { width: 104, height: 104, borderRadius: 5, overflow: 'hidden', backgroundColor: C.pale },
  cardImageWrapGrid: { width: '100%', height: 168 },
  imagePlaceholder: { width: '100%', backgroundColor: '#EEF1F7', alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { color: '#8F9AB0', fontSize: 30 },
  placeholderText: { color: C.muted, fontSize: 9, marginTop: 3 },
  productInfo: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' },
  productName: { color: C.ink, fontSize: 13, lineHeight: 18, fontWeight: '800', marginBottom: 5 },
  productPrice: { color: C.blue, fontSize: 13, fontWeight: '800', marginBottom: 7 },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stockLabel: { color: C.muted, fontSize: 10 },
  stockValue: { color: C.green, backgroundColor: '#EAF8F0', overflow: 'hidden', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, fontSize: 10, fontWeight: '800' },
  cardActions: { justifyContent: 'center', gap: 3 },
  cardActionsGrid: { flexDirection: 'row', justifyContent: 'flex-end', alignSelf: 'stretch' },
  rowAction: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  editActionText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  deleteActionText: { color: C.red, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  listFootnote: { textAlign: 'center', color: '#99A3B4', fontSize: 10, paddingVertical: 15 },
  emptyState: { alignItems: 'center', paddingTop: 85, paddingHorizontal: 20 },
  emptyIcon: { color: '#AAB4C6', fontSize: 42 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '800', marginTop: 11 },
  emptySubtitle: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 6 },
  fab: { position: 'absolute', right: 19, bottom: 19, width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue, elevation: 5, shadowColor: C.blue, shadowOpacity: 0.2, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  fabText: { color: '#fff', fontSize: 29, marginTop: -2 },
  subHeader: { height: 55, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  backButton: { width: 31, height: 42, justifyContent: 'center' },
  backGlyph: { color: C.blue, fontSize: 31, lineHeight: 36 },
  subTitle: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '800' },
  readOnlyBadge: { color: C.blue, backgroundColor: C.blueSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '800' },
  detailContent: { width: '100%', maxWidth: 820, alignSelf: 'center', padding: 20, paddingBottom: 38, gap: 11 },
  detailHero: { alignItems: 'center', paddingHorizontal: 6, paddingTop: 5, paddingBottom: 12 },
  detailImage: { width: '100%', maxWidth: 420, borderRadius: 18, overflow: 'hidden', backgroundColor: C.pale },
  detailName: { color: C.ink, textAlign: 'center', fontSize: 20, lineHeight: 26, fontWeight: '800', marginTop: 14 },
  detailPrice: { color: C.blue, fontSize: 18, fontWeight: '800', marginTop: 4 },
  attributesCard: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 3, marginBottom: 3 },
  sectionEyebrow: { color: C.muted, fontSize: 10, fontWeight: '800', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  attributeRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#F0F2F6' },
  lastAttribute: { borderBottomWidth: 0 },
  attributeIcon: { width: 31, height: 31, borderRadius: 10, overflow: 'hidden', backgroundColor: C.blueSoft, color: C.blue, textAlign: 'center', textAlignVertical: 'center', fontSize: 15 },
  attributeLabel: { color: C.muted, fontSize: 9, letterSpacing: 0.5, marginBottom: 3 },
  attributeValue: { color: C.ink, fontSize: 12, fontWeight: '700' },
  button: { height: 47, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  primaryButton: { backgroundColor: C.blue },
  outlineButton: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.red },
  dangerButton: { backgroundColor: C.red },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.6 },
  outlineButtonText: { color: C.red },
  formContent: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 20, paddingBottom: 38, gap: 12 },
  photoPicker: { alignItems: 'center', paddingVertical: 4 },
  photoFrame: { position: 'relative', width: 116, height: 94, borderRadius: 15, overflow: 'visible' },
  formPhoto: { width: 116, height: 94, borderRadius: 15, borderWidth: 2, borderColor: C.blue },
  formPhotoPlaceholder: { width: 116, height: 94, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: '#EEF1F7', alignItems: 'center', justifyContent: 'center' },
  cameraBadge: { position: 'absolute', right: -8, bottom: -7, width: 29, height: 29, borderRadius: 15, borderColor: C.bg, borderWidth: 2, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  cameraBadgeText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  photoTitle: { color: C.blue, fontSize: 12, fontWeight: '800', marginTop: 12 },
  photoHint: { color: C.muted, fontSize: 10, marginTop: 3 },
  formCard: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 13, gap: 13 },
  fieldBlock: { gap: 6 },
  fieldLabel: { color: C.ink, fontSize: 11, fontWeight: '800' },
  inputWrap: { minHeight: 45, borderWidth: 1, borderColor: '#D8DEED', borderRadius: 5, backgroundColor: '#F7F8FC', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11 },
  input: { flex: 1, minWidth: 0, color: C.ink, fontSize: 13, paddingVertical: 9 },
  inputSuffix: { color: C.muted, fontSize: 10, fontWeight: '700', marginLeft: 8 },
  onlyFieldsNote: { textAlign: 'center', color: C.muted, fontSize: 10, lineHeight: 15, paddingHorizontal: 12 },
  resetAction: { color: C.blue, fontSize: 11, fontWeight: '800', padding: 7 },
  cancelLink: { alignItems: 'center', padding: 8 },
  cancelText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  loginPage: { flex: 1, justifyContent: 'center' },
  loginContent: { flexGrow: 1, justifyContent: 'center', padding: 23, paddingVertical: 40 },
  loginLogo: { width: 62, height: 62, borderRadius: 19, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  loginLogoText: { color: '#fff', fontSize: 27, fontWeight: '900' },
  loginTitle: { color: C.ink, fontSize: 23, fontWeight: '900', textAlign: 'center' },
  loginSubtitle: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 5, marginBottom: 20 },
  loginCard: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 17, padding: 14, gap: 13 },
  loginFootnote: { color: C.muted, fontSize: 10, textAlign: 'center', marginTop: 14 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16, 24, 40, 0.28)' },
  centeredBackdrop: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  filterSheet: { width: '100%', backgroundColor: C.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 21, paddingTop: 13, paddingBottom: 28, gap: 10 },
  filterDialog: { maxWidth: 560, borderRadius: 11, padding: 23, gap: 12, borderWidth: 1, borderColor: C.line, elevation: 6, shadowColor: '#15213C', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  filterTitle: { color: C.ink, fontSize: 17, fontWeight: '900' },
  filterSubtitle: { color: C.muted, fontSize: 11, marginTop: 3 },
  closeFilter: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  closeFilterText: { color: C.muted, fontSize: 24, lineHeight: 27 },
  filterLabel: { color: C.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.65, marginTop: 5 },
  filterChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { borderRadius: 5, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 11, paddingVertical: 9 },
  filterChipSelected: { borderColor: C.blue, backgroundColor: C.blueSoft },
  filterChipText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  filterChipTextSelected: { color: C.blue },
  directionButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.pale, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 8 },
  directionIcon: { color: C.blue, fontSize: 17, fontWeight: '900' },
  directionText: { color: C.ink, fontSize: 11, fontWeight: '800' },
  directionHint: { color: C.muted, fontSize: 9, marginLeft: 4 },
  priceRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  priceRangeInput: { flex: 1, minWidth: 0, height: 42, borderRadius: 5, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 11, color: C.ink, fontSize: 12 },
  priceRangeSeparator: { color: C.muted, fontSize: 10 },
  filterFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  clearFiltersButton: { flex: 1, height: 45, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  clearFiltersText: { color: C.muted, fontSize: 12, fontWeight: '800' },
  applyFiltersButton: { flex: 1.3, height: 45, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.blue },
  applyFiltersText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  photoSheet: { paddingHorizontal: 21, paddingTop: 12, paddingBottom: 27, backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#CFD5DF', alignSelf: 'center', marginBottom: 18 },
  sheetTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginBottom: 7 },
  sheetOption: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F2F6' },
  sheetIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.blueSoft, color: C.blue, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontSize: 17 },
  sheetOptionText: { color: C.ink, fontSize: 13, fontWeight: '700' },
  removeIcon: { color: C.red },
  removeText: { color: C.red, fontSize: 13, fontWeight: '700' },
  sheetCancel: { alignItems: 'center', paddingTop: 15 },
});
