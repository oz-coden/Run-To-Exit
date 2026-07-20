using UnityEngine;
using UnityEngine.Tilemaps;

public class PlayerController : MonoBehaviour
{
    [Header("Move Settings")]
    public float moveSpeed = 5f;

    [Header("Reference Environments")]
    public Grid grid;
    public Tilemap interactableTilemap;

    [Header("Rule Setting")]
    public LayerMask interactableLayer;

    private Vector2 facingDirection = Vector2.right;

    private Vector3 debugTargetCenter;

    void Start()
    {

    }

    void Update()
    {
        HandleMovement();

        if (Input.GetKeyDown(KeyCode.Space))
        {
            TryInteract();
        }
    }

    private void HandleMovement()
    {
        float inputX = Input.GetAxisRaw("Horizontal");
        float inputY = Input.GetAxisRaw("Vertical");

        if (inputX != 0 || inputY != 0)
        {
            Vector2 moveDirection = new Vector2(inputX, inputY).normalized;

            transform.Translate(moveDirection * moveSpeed * Time.deltaTime);

            if (Mathf.Abs(inputX) > 0.1f) facingDirection = new Vector2(Mathf.Sign(inputX), 0);
            else if (Mathf.Abs(inputY) > 0.1f) facingDirection = new Vector2(0, Mathf.Sign(inputY));
        }
    }

    private void TryInteract()
    {
        Vector3 footPosition = transform.position + new Vector3(0, -0.5f, 0);

        Vector3Int currentCell = grid.WorldToCell(footPosition);

        Vector3Int targetCell = currentCell + new Vector3Int((int)facingDirection.x, (int)facingDirection.y, 0);

        Vector3 targetWorldCenter = grid.GetCellCenterWorld(targetCell);
        debugTargetCenter = targetWorldCenter;
        Debug.Log($"現在マス:{currentCell} / 調べるマス:{targetCell} / 向き:{facingDirection}");
        Collider2D hitObj = Physics2D.OverlapCircle(targetWorldCenter, 0.8f, interactableLayer);

        if (hitObj != null)
        {
            Debug.Log("a");
            MovableBox box = hitObj.GetComponent<MovableBox>();
            if (box != null)
            {
                Debug.Log("b");
                box.Interact(facingDirection);
                return;
            }
        }

        if (interactableTilemap != null)
        {
            TileBase hitTile = interactableTilemap.GetTile(targetCell);
            if (hitTile != null)
            {
                Debug.Log($"タイル（{hitTile.name}）を発見しました！");
                return;
            }
        }

        Debug.Log("目の前には何もありません。");
    }

    // UnityエディタのSceneビューに、判定の円を描画する機能
    private void OnDrawGizmos()
    {
        // 調べている場所（赤い円）
        Gizmos.color = Color.red;
        Gizmos.DrawWireSphere(debugTargetCenter, 0.8f);

        // プレイヤーが向いている方向（緑の線）
        Gizmos.color = Color.green;
        Gizmos.DrawRay(transform.position, facingDirection);
    }

}
